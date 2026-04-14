import { InlineKeyboard } from 'grammy';
import { getAICommentary } from '../../services/ai.service';
import {
  type FoodSearchResult,
  cacheFood,
  formatFoodSearchResults,
  lookupAllItems,
} from '../../services/food-api.service';
import { buildDaySummaryText, foodService } from '../../services/food.service';
import { getCycleInfo, getWeekNumber, todayString } from '../../utils/day-type';
import { parseFoodText } from '../../utils/parser';
import { backToMenuKeyboard } from '../keyboards/main';
import type { BotContext } from '../types';

// ─── Keyboards ────────────────────────────────────────────────────────────────

function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ Отмена', 'action:main_menu');
}

function confirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Подтвердить', 'food:confirm')
    .text('✏️ Вручную', 'food:manual_entry');
}

function foodAfterKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Ещё приём', 'action:food_menu')
    .text('🏠 Меню', 'action:main_menu');
}

function skipMealKeyboard(mealNum: 1 | 2 | 3): InlineKeyboard {
  return new InlineKeyboard()
    .text('🍽️ Записать', 'action:food_menu')
    .text('Пропустил', `food:skip_meal${mealNum}`);
}

export { skipMealKeyboard };

// ─── Callback: "🍽️ Питание" button ─────────────────────────────────────────────

export async function foodMenuHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.step = 'awaiting_food_text';
  ctx.session.pendingFood = undefined;

  await ctx.reply(
    '🍽️ Что съел? Введи продукты и граммы.\n\n' +
      '_Пример: курица 200г рис 100г_\n' +
      '_Или: куриная грудка 180гр, гречка 150г_',
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
  );
}

// ─── /food command ────────────────────────────────────────────────────────────

export async function foodCommand(ctx: BotContext): Promise<void> {
  ctx.session.step = 'awaiting_food_text';
  ctx.session.pendingFood = undefined;

  await ctx.reply('🍽️ Что съел? Введи продукты и граммы.\n\n' + '_Пример: курица 200г рис 100г_', {
    parse_mode: 'Markdown',
    reply_markup: cancelKeyboard(),
  });
}

// ─── Step 1: parse text + search APIs ────────────────────────────────────────

export async function foodTextHandler(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  const items = parseFoodText(text);

  if (items.length === 0) {
    await ctx.reply(
      '❌ Не понял. Напиши название продукта и граммы, например:\n_курица 200г_\n\n' +
        'Или несколько: _курица 200г рис 100г_',
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
    );
    return;
  }

  // Show "searching..." hint for multiple items
  if (items.length > 1) {
    await ctx.reply('🔍 Ищу данные о продуктах...', { parse_mode: 'Markdown' });
  }

  const results = await lookupAllItems(items, ctx.dbUser.id);

  const found = results.filter((r) => r.nutrition !== null);
  const missing = results.filter((r) => r.nutrition === null);

  if (found.length === 0) {
    // Nothing found — fall back to manual entry
    ctx.session.step = 'awaiting_food_nutrition';
    const combinedName = items.map((i) => `${i.name} ${i.grams}г`).join(', ');
    const totalGrams = Math.round(items.reduce((s, i) => s + i.grams, 0));
    ctx.session.pendingFood = [
      {
        food_name: combinedName,
        grams: totalGrams,
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        source: 'manual',
      },
    ];

    await ctx.reply(
      `❓ Не нашёл данные для: *${items.map((i) => i.name).join(', ')}*\n\nВведи *ккал и белок* через пробел:\n_Пример: 580 75_`,
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
    );
    return;
  }

  // Store found items as pending for confirmation
  ctx.session.pendingFood = found.map((r) => ({
    food_name: `${r.item.name} ${r.item.grams}г`,
    grams: r.item.grams,
    calories: r.nutrition?.kcal ?? 0,
    protein: r.nutrition?.protein ?? 0,
    fat: r.nutrition?.fat ?? 0,
    carbs: r.nutrition?.carbs ?? 0,
    source: r.nutrition?.source ?? 'manual',
  }));
  ctx.session.step = 'awaiting_food_confirm';

  let previewText = formatFoodSearchResults(results);

  if (missing.length > 0) {
    previewText += '\n\n⚠️ _Продукты без данных не будут записаны. Добавь их отдельно._';
  }

  previewText += '\n\nПодтвердить запись?';

  await ctx.reply(previewText, {
    parse_mode: 'Markdown',
    reply_markup: confirmKeyboard(),
  });
}

// ─── Callback: confirm found nutrition ───────────────────────────────────────

export async function foodConfirmHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const pendingItems = ctx.session.pendingFood;
  if (!pendingItems || pendingItems.length === 0) {
    ctx.session.step = null;
    await ctx.reply('❌ Данные устарели. Введи заново.', { reply_markup: cancelKeyboard() });
    return;
  }

  ctx.session.step = null;
  ctx.session.pendingFood = undefined;

  const { id: userId, start_date, goal_weight } = ctx.dbUser;
  const startDate = new Date(start_date);

  // Save each item and cache nutrition data
  for (const item of pendingItems) {
    await foodService.saveFood({
      userId,
      startDate,
      foodName: item.food_name,
      grams: item.grams,
      calories: item.calories,
      protein: item.protein,
      fat: item.fat,
      carbs: item.carbs,
      source: item.source,
    });

    // Cache to frequent_foods if came from API (not already cached)
    if (item.source !== 'cache' && item.source !== 'manual') {
      await cacheFood(userId, {
        name: item.food_name,
        kcal: item.calories,
        protein: item.protein,
        fat: item.fat,
        carbs: item.carbs,
        kcalPer100g: item.grams > 0 ? Math.round((item.calories / item.grams) * 100) : 0,
        proteinPer100g:
          item.grams > 0 ? Math.round((item.protein / item.grams) * 100 * 10) / 10 : 0,
        fatPer100g: item.grams > 0 ? Math.round((item.fat / item.grams) * 100 * 10) / 10 : 0,
        carbsPer100g: item.grams > 0 ? Math.round((item.carbs / item.grams) * 100 * 10) / 10 : 0,
        source: item.source as FoodSearchResult['nutrition'] extends null ? never : 'openfoodfacts',
      });
    }
  }

  const today = todayString();
  const weekNumber = getWeekNumber(startDate, new Date());
  const totalKcal = Math.round(pendingItems.reduce((s, i) => s + i.calories, 0));
  const totalProtein = Math.round(pendingItems.reduce((s, i) => s + i.protein, 0) * 10) / 10;
  const names = pendingItems.map((i) => i.food_name).join(', ');

  const [summary, aiComment] = await Promise.all([
    foodService.getDailySummary(userId, today),
    getAICommentary({
      trigger: 'food',
      userId,
      startDate,
      goalWeight: goal_weight,
      eventDetail: `записал: ${names} — ${totalKcal} ккал, ${totalProtein}г белка`,
    }),
  ]);

  const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);

  let replyText = `✅ Записал: *${names}*\n` + `${totalKcal} ккал · ${totalProtein}г белка\n\n`;

  if (summary) {
    replyText += buildDaySummaryText(summary, weekNumber, cycleNumber, isDietBreak);
  }

  if (aiComment) {
    replyText += `\n\n🤖 _${aiComment}_`;
  }

  await ctx.reply(replyText, {
    parse_mode: 'Markdown',
    reply_markup: foodAfterKeyboard(),
  });
}

// ─── Callback: switch to manual entry ────────────────────────────────────────

export async function foodManualEntryHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  // Keep pendingFood but overwrite nutrition with zeros for manual entry
  if (ctx.session.pendingFood) {
    for (const item of ctx.session.pendingFood) {
      item.calories = 0;
      item.protein = 0;
      item.fat = 0;
      item.carbs = 0;
      item.source = 'manual';
    }
  }
  ctx.session.step = 'awaiting_food_nutrition';

  const names = ctx.session.pendingFood?.map((i) => i.food_name).join(', ') ?? '—';

  await ctx.reply(
    `✏️ Вводим вручную для: *${names}*\n\nВведи *ккал и белок* через пробел:\n_Пример: 580 75_`,
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
  );
}

// ─── Step 2 (manual fallback): receive kcal + protein ────────────────────────

export async function foodNutritionHandler(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  const parts = text.split(/\s+/);
  const calories = Number.parseFloat((parts[0] ?? '').replace(',', '.'));
  const protein = Number.parseFloat((parts[1] ?? '0').replace(',', '.'));

  if (Number.isNaN(calories) || calories < 0 || calories > 9000) {
    await ctx.reply('❌ Не понял. Введи ккал и белок через пробел, например: *580 75*', {
      parse_mode: 'Markdown',
    });
    return;
  }

  if (Number.isNaN(protein) || protein < 0 || protein > 500) {
    await ctx.reply('❌ Белок указан некорректно. Пример: *580 75*', { parse_mode: 'Markdown' });
    return;
  }

  const pending = ctx.session.pendingFood?.[0];
  if (!pending) {
    ctx.session.step = null;
    return;
  }

  ctx.session.step = null;
  ctx.session.pendingFood = undefined;

  const { id: userId, start_date, goal_weight } = ctx.dbUser;
  const startDate = new Date(start_date);

  await foodService.saveFood({
    userId,
    startDate,
    foodName: pending.food_name,
    grams: pending.grams,
    calories,
    protein,
    fat: 0,
    carbs: 0,
    source: 'manual',
  });

  const today = todayString();
  const weekNumber = getWeekNumber(startDate, new Date());

  const [summary, aiComment] = await Promise.all([
    foodService.getDailySummary(userId, today),
    getAICommentary({
      trigger: 'food',
      userId,
      startDate,
      goalWeight: goal_weight,
      eventDetail: `записал вручную: ${pending.food_name} — ${Math.round(calories)} ккал, ${Math.round(protein)}г белка`,
    }),
  ]);

  const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);

  let replyText =
    `✅ Записал: *${pending.food_name}*\n` +
    `${Math.round(calories)} ккал · ${Math.round(protein)}г белка\n\n`;

  if (summary) {
    replyText += buildDaySummaryText(summary, weekNumber, cycleNumber, isDietBreak);
  }

  if (aiComment) {
    replyText += `\n\n🤖 _${aiComment}_`;
  }

  await ctx.reply(replyText, {
    parse_mode: 'Markdown',
    reply_markup: foodAfterKeyboard(),
  });
}

// ─── Callback: show daily summary ─────────────────────────────────────────────

export async function dailySummaryHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const today = todayString();
  const { id: userId, start_date } = ctx.dbUser;
  const startDate = new Date(start_date);

  const summary = await foodService.getDailySummary(userId, today);
  const weekNumber = getWeekNumber(startDate, new Date());
  const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);

  if (!summary) {
    await ctx.reply('📊 Данных за сегодня пока нет.\n\nЗапиши вес и еду — тогда появится итог.', {
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  await ctx.reply(buildDaySummaryText(summary, weekNumber, cycleNumber, isDietBreak), {
    parse_mode: 'Markdown',
    reply_markup: backToMenuKeyboard(),
  });
}

// ─── Callbacks: skip meal ─────────────────────────────────────────────────────

export async function skipMealHandler(ctx: BotContext, mealNum: 1 | 2 | 3): Promise<void> {
  await ctx.answerCallbackQuery();

  const today = todayString();
  await foodService.markMealSkipped(ctx.dbUser.id, today, mealNum);

  const mealLabel = mealNum === 1 ? '11:00' : mealNum === 2 ? '15:00' : '18:30';

  await ctx.reply(
    `✅ Приём ${mealNum} (${mealLabel}) — пропущен. Больше не буду напоминать об этом приёме.`,
    { reply_markup: backToMenuKeyboard() },
  );
}
