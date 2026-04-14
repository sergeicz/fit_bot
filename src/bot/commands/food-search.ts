import { InlineKeyboard } from 'grammy';
import { getAICommentary } from '../../services/ai.service';
import {
  type SearchFoodResult,
  cacheFood,
  searchFoodByQuery,
} from '../../services/food-api.service';
import { buildDaySummaryText, foodService } from '../../services/food.service';
import { getCycleInfo, getWeekNumber, todayString } from '../../utils/day-type';
import { backToMenuKeyboard } from '../keyboards/main';
import type { BotContext } from '../types';

const SOURCE_LABEL: Record<SearchFoodResult['source'], string> = {
  cache: '📁',
  openfoodfacts: '🌍',
  ai: '🤖~',
};

function searchResultsKeyboard(count: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < count; i++) {
    kb.text(`➕ Вариант ${i + 1}`, `food_search:use:${i}`);
    if (i < count - 1) kb.row();
  }
  kb.row().text('❌ Отмена', 'action:main_menu');
  return kb;
}

// ─── Search entry point (called from input-detector) ─────────────────────────

export async function foodSearchHandler(ctx: BotContext, query: string): Promise<void> {
  const { id: userId } = ctx.dbUser;

  const hint = await ctx.reply('🔍 Ищу...');

  const results = await searchFoodByQuery(query, userId);

  await ctx.api.deleteMessage(ctx.chat!.id, hint.message_id).catch(() => {});

  if (results.length === 0) {
    await ctx.reply(
      `❓ Ничего не нашёл по запросу *"${query}"*.\n\n` +
        'Попробуй другое написание или запиши вручную через *🍽️ Питание*.',
      { parse_mode: 'Markdown', reply_markup: backToMenuKeyboard() },
    );
    return;
  }

  ctx.session.pendingSearchResults = results;

  let text = `🔍 *Результаты: "${query}"*\n\n`;
  results.forEach((r, i) => {
    text += `*${i + 1}. ${r.name}* ${SOURCE_LABEL[r.source]}\n`;
    text += `на 100г: ${r.kcalPer100g} ккал · ${r.proteinPer100g}г белка · ${r.fatPer100g}г жира · ${r.carbsPer100g}г углеводов\n\n`;
  });
  text += '_Нажми кнопку чтобы записать нужный вариант в приём пищи._';

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: searchResultsKeyboard(results.length),
  });
}

// ─── Callback: user picked a variant ─────────────────────────────────────────

export async function foodSearchUseCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const match = ctx.callbackQuery?.data?.match(/^food_search:use:(\d+)$/);
  if (!match) return;

  const idx = parseInt(match[1], 10);
  const selected = ctx.session.pendingSearchResults?.[idx];

  if (!selected) {
    await ctx.reply('❌ Данные устарели — повтори поиск.');
    return;
  }

  ctx.session.pendingSearchResult = selected;
  ctx.session.step = 'awaiting_search_grams';

  const kb = new InlineKeyboard().text('❌ Отмена', 'action:main_menu');

  await ctx.reply(
    `*${selected.name}*\nна 100г: ${selected.kcalPer100g} ккал · ${selected.proteinPer100g}г белка\n\nСколько грамм?`,
    { parse_mode: 'Markdown', reply_markup: kb },
  );
}

// ─── Step: receive grams after picking a search result ───────────────────────

export async function foodSearchGramsHandler(ctx: BotContext): Promise<void> {
  if (ctx.session.step !== 'awaiting_search_grams') return;

  const text = ctx.message?.text?.trim();
  if (!text) return;

  const grams = parseFloat(text.replace(',', '.'));
  if (Number.isNaN(grams) || grams <= 0 || grams > 3000) {
    await ctx.reply('❌ Введи количество грамм числом, например: *150*', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const selected = ctx.session.pendingSearchResult;
  if (!selected) {
    ctx.session.step = null;
    await ctx.reply('❌ Данные устарели — повтори поиск.');
    return;
  }

  ctx.session.step = null;
  ctx.session.pendingSearchResult = undefined;
  ctx.session.pendingSearchResults = undefined;

  const { id: userId, start_date, goal_weight } = ctx.dbUser;
  const startDate = new Date(start_date);

  const factor = grams / 100;
  const calories = Math.round(selected.kcalPer100g * factor);
  const protein = Math.round(selected.proteinPer100g * factor * 10) / 10;
  const fat = Math.round(selected.fatPer100g * factor * 10) / 10;
  const carbs = Math.round(selected.carbsPer100g * factor * 10) / 10;

  const foodName = `${selected.name} ${grams}г`;

  await foodService.saveFood({
    userId,
    startDate,
    foodName,
    grams,
    calories,
    protein,
    fat,
    carbs,
    source: selected.source,
  });

  if (selected.source !== 'cache') {
    await cacheFood(userId, {
      name: selected.name,
      kcal: calories,
      protein,
      fat,
      carbs,
      kcalPer100g: selected.kcalPer100g,
      proteinPer100g: selected.proteinPer100g,
      fatPer100g: selected.fatPer100g,
      carbsPer100g: selected.carbsPer100g,
      source: selected.source,
    });
  }

  const today = todayString();
  const weekNumber = getWeekNumber(startDate, new Date());
  const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);

  const [summary, aiComment] = await Promise.all([
    foodService.getDailySummary(userId, today),
    getAICommentary({
      trigger: 'food',
      userId,
      startDate,
      goalWeight: goal_weight,
      eventDetail: `записал: ${foodName} — ${calories} ккал, ${protein}г белка`,
    }),
  ]);

  let replyText =
    `✅ Записал: *${foodName}*\n` +
    `${calories} ккал · ${protein}г белка · ${fat}г жира · ${carbs}г углеводов\n\n`;

  if (summary) {
    replyText += buildDaySummaryText(summary, weekNumber, cycleNumber, isDietBreak);
  }
  if (aiComment) {
    replyText += `\n\n🤖 _${aiComment}_`;
  }

  const kb = new InlineKeyboard()
    .text('➕ Ещё приём', 'action:food_menu')
    .text('🏠 Меню', 'action:main_menu');

  await ctx.reply(replyText, { parse_mode: 'Markdown', reply_markup: kb });
}
