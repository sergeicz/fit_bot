import { InlineKeyboard } from 'grammy';
import { getAICommentary } from '../../services/ai.service';
import { buildWeightConfirmText, weightService } from '../../services/weight.service';
import { getCycleInfo, getWeekNumber, todayString } from '../../utils/day-type';
import { backToMenuKeyboard, weightActionsKeyboard } from '../keyboards/main';
import type { BotContext } from '../types';

// ─── Callback: user pressed "⚖️ Внести вес" button ───────────────────────────

export async function weightCallbackHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.step = 'awaiting_weight';

  await ctx.reply('⚖️ Введи вес (натощак, до еды).\nПример: *95.4*', { parse_mode: 'Markdown' });
}

// ─── Text handler: processes weight value ─────────────────────────────────────

export async function weightTextHandler(ctx: BotContext): Promise<void> {
  if (ctx.session.step !== 'awaiting_weight' && ctx.session.step !== 'awaiting_weight_not_fasted') {
    return;
  }

  await handleWeightInput(ctx);
}

// ─── Core weight processing (used by both text handler and input-detector) ────

export async function handleWeightInput(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim().replace(',', '.');
  if (!text) return;

  const weight = Number.parseFloat(text);

  if (Number.isNaN(weight) || weight < 30 || weight > 300) {
    await ctx.reply('❌ Не понял. Введи вес числом, например: *95.4*', { parse_mode: 'Markdown' });
    return;
  }

  const isFasted = ctx.session.step !== 'awaiting_weight_not_fasted';
  ctx.session.step = null;

  const today = todayString();
  const { id: userId, start_date, goal_weight } = ctx.dbUser;
  const startDate = new Date(start_date);

  // Save first so subsequent queries see the new weight
  await weightService.saveWeight({ userId, date: today, weight, isFasted });

  // Then fetch trend, history and AI commentary in parallel
  const [trend, history, aiComment] = await Promise.all([
    weightService.getWeightTrend(userId),
    weightService.getWeightHistory(userId, 2),
    getAICommentary({
      trigger: 'weight',
      userId,
      startDate,
      goalWeight: goal_weight,
      eventDetail: `записал вес ${weight} кг${isFasted ? ' (натощак)' : ' (не натощак)'}`,
    }),
  ]);

  const weekNumber = getWeekNumber(startDate, new Date());
  const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);

  // Warn if weight went up during or after diet break (expected: water weight)
  let extraNote = '';
  if (history.length === 2 && history[0].weight > history[1].weight) {
    const diff = (history[0].weight - history[1].weight).toFixed(1);
    if (isDietBreak || weekNumber === 14) {
      extraNote =
        `\n\n⚠️ +${diff} кг — это вода и гликоген от diet break.\n` +
        `Жир не растёт. Продолжай план, к концу недели уйдёт.`;
    }
  }

  let confirmText = buildWeightConfirmText({
    weight,
    isFasted,
    trend,
    weekNumber,
    cycleNumber,
    isDietBreak,
    goalWeight: goal_weight,
  }) + extraNote;

  if (aiComment) {
    confirmText += `\n\n🤖 _${aiComment}_`;
  }

  await ctx.reply(confirmText, {
    parse_mode: 'Markdown',
    reply_markup: weightActionsKeyboard(),
  });
}

// ─── "Not fasted" shortcut ────────────────────────────────────────────────────

export function notFastedKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('⚖️ Внести вес (не натощак)', 'weight:not_fasted')
    .text('⚖️ Внести натощак', 'action:log_weight');
}
