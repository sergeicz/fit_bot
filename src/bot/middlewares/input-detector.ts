import type { NextFunction } from 'grammy';
import { getAICommentary } from '../../services/ai.service';
import { isEatingWindow } from '../../utils/day-type';
import { foodNutritionHandler, foodTextHandler } from '../commands/food';
import { foodSearchGramsHandler, foodSearchHandler } from '../commands/food-search';
import { stepsTextHandler } from '../commands/steps';
import { handleWeightInput } from '../commands/weight';
import type { BotContext } from '../types';

/** Regex: plain number or decimal — treated as weight input */
const WEIGHT_PATTERN = /^\d{2,3}([.,]\d{1,2})?$/;

/** Regex: food entry — contains a product name (letters) and optionally grams */
const FOOD_PATTERN = /[а-яёa-z]{2,}/i;

/** Regex: food search intent — "найди X", "поищи X", "ищи X" etc. */
const SEARCH_PATTERN = /^(найди|поищи|ищи|найти|найди мне|найди в базе|поиск|search)\s+(.+)/i;

/**
 * Routes free-text messages based on session step or auto-detection.
 *
 * Priority:
 * 1. If a step is active → honour the active flow
 * 2. Looks like weight (e.g. "95.4") → weight flow
 * 3. Looks like food (letters) → food flow
 * 4. Otherwise → AI
 */
export async function inputDetector(ctx: BotContext, next: NextFunction): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) {
    await next();
    return;
  }

  // 1. Respect active flow
  if (ctx.session.step === 'awaiting_weight' || ctx.session.step === 'awaiting_weight_not_fasted') {
    await handleWeightInput(ctx);
    return;
  }

  if (ctx.session.step === 'awaiting_food_text') {
    await foodTextHandler(ctx);
    return;
  }

  if (ctx.session.step === 'awaiting_food_nutrition') {
    await foodNutritionHandler(ctx);
    return;
  }

  if (ctx.session.step === 'awaiting_food_confirm' || ctx.session.step === 'awaiting_food_grams') {
    await next(); // future food flow handlers pick this up
    return;
  }

  if (ctx.session.step === 'awaiting_steps') {
    await stepsTextHandler(ctx);
    return;
  }

  if (ctx.session.step === 'awaiting_search_grams') {
    await foodSearchGramsHandler(ctx);
    return;
  }

  // 2. Auto-detect weight
  if (WEIGHT_PATTERN.test(text)) {
    ctx.session.step = 'awaiting_weight';
    await handleWeightInput(ctx);
    return;
  }

  // 3. Search intent ("найди X", "поищи X")
  const searchMatch = SEARCH_PATTERN.exec(text);
  if (searchMatch) {
    const query = searchMatch[2].trim();
    await foodSearchHandler(ctx, query);
    return;
  }

  // 4. Auto-detect food (only inside eating window — warn outside)
  if (FOOD_PATTERN.test(text)) {
    if (!isEatingWindow(new Date())) {
      await ctx.reply(
        '⏰ Сейчас не время приёма пищи — окно питания 11:00–19:00 (16/8).\n\n' +
          'Записать всё равно? Введи /food или нажми кнопку «🍽️ Питание» в меню.',
      );
      return;
    }
    ctx.session.step = 'awaiting_food_text';
    await foodTextHandler(ctx);
    return;
  }

  // 5. Fallback — send to AI as a question
  const { id: userId, start_date, goal_weight } = ctx.dbUser;
  const aiReply = await getAICommentary({
    trigger: 'question',
    userId,
    startDate: new Date(start_date),
    goalWeight: goal_weight,
    eventDetail: `Вопрос пользователя: "${text}"`,
  });

  if (aiReply) {
    await ctx.reply(aiReply, { parse_mode: 'Markdown' });
  } else {
    await next();
  }
}
