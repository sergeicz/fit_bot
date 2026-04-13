import { InlineKeyboard } from 'grammy';
import { buildDaySummaryText, foodService } from '../../services/food.service';
import { getCycleInfo, getWeekNumber, todayString } from '../../utils/day-type';
import { formatParsedItems, parseFoodText } from '../../utils/parser';
import { backToMenuKeyboard } from '../keyboards/main';
import type { BotContext } from '../types';

// ─── Keyboards ────────────────────────────────────────────────────────────────

function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ Отмена', 'action:main_menu');
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

// ─── /food command (text entry point) ────────────────────────────────────────

export async function foodCommand(ctx: BotContext): Promise<void> {
  ctx.session.step = 'awaiting_food_text';
  ctx.session.pendingFood = undefined;

  await ctx.reply('🍽️ Что съел? Введи продукты и граммы.\n\n' + '_Пример: курица 200г рис 100г_', {
    parse_mode: 'Markdown',
    reply_markup: cancelKeyboard(),
  });
}

// ─── Step 1: parse food text ──────────────────────────────────────────────────

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

  // Combine all parsed items into one pending session entry
  const combinedName = items.map((i) => `${i.name} ${i.grams}г`).join(', ');
  const totalGrams = Math.round(items.reduce((sum, i) => sum + i.grams, 0));

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
  ctx.session.step = 'awaiting_food_nutrition';

  const preview = formatParsedItems(items);
  await ctx.reply(
    `📝 Записать:\n${preview}\n\nВведи *ккал и белок* через пробел:\n_Пример: 580 75_`,
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
  );
}

// ─── Step 2: receive nutrition values ────────────────────────────────────────

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

  const { id: userId, start_date } = ctx.dbUser;

  await foodService.saveFood({
    userId,
    startDate: new Date(start_date),
    foodName: pending.food_name,
    grams: pending.grams,
    calories,
    protein,
    fat: 0,
    carbs: 0,
    source: 'manual',
  });

  const today = todayString();
  const summary = await foodService.getDailySummary(userId, today);
  const startDate = new Date(start_date);
  const weekNumber = getWeekNumber(startDate, new Date());
  const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);

  let replyText =
    `✅ Записал: *${pending.food_name}*\n` +
    `${Math.round(calories)} ккал · ${Math.round(protein)}г белка\n\n`;

  if (summary) {
    replyText += buildDaySummaryText(summary, weekNumber, cycleNumber, isDietBreak);
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
