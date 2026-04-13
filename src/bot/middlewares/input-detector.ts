import type { NextFunction } from 'grammy';
import type { BotContext } from '../types';
import { handleWeightInput } from '../commands/weight';
import { isEatingWindow } from '../../utils/day-type';

/** Regex: plain number or decimal — treated as weight input */
const WEIGHT_PATTERN = /^\d{2,3}([.,]\d{1,2})?$/;

/** Regex: food entry — contains a product name (letters) and optionally grams */
const FOOD_PATTERN = /[а-яёa-z]{2,}/i;

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

  if (ctx.session.step === 'awaiting_food_text' || ctx.session.step === 'awaiting_food_confirm') {
    await next(); // food command handlers pick this up
    return;
  }

  if (ctx.session.step === 'awaiting_steps') {
    await next(); // steps command handler picks this up
    return;
  }

  // 2. Auto-detect weight
  if (WEIGHT_PATTERN.test(text)) {
    ctx.session.step = 'awaiting_weight';
    await handleWeightInput(ctx);
    return;
  }

  // 3. Auto-detect food (only inside eating window — warn outside)
  if (FOOD_PATTERN.test(text)) {
    if (!isEatingWindow(new Date())) {
      await ctx.reply(
        '⏰ Сейчас не время приёма пищи — окно питания 11:00–19:00 (16/8).\n\n' +
          'Записать всё равно? Введи /food или нажми кнопку «🍽️ Питание» в меню.',
      );
      return;
    }
    ctx.session.step = 'awaiting_food_text';
    await next(); // food command handler picks this up
    return;
  }

  // 4. Fallback — pass to AI or next handler
  await next();
}
