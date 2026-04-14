import { supabase } from '../../db/client';
import { getAICommentary } from '../../services/ai.service';
import { foodService } from '../../services/food.service';
import { todayString } from '../../utils/day-type';
import { backToMenuKeyboard } from '../keyboards/main';
import type { BotContext } from '../types';

// ─── Callback: user pressed "🚶 Шаги" button ──────────────────────────────────

export async function stepsCallbackHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.step = 'awaiting_steps';

  await ctx.reply(
    '🚶 Введи количество шагов за сегодня.\nПример: *7500*\n\n' +
      'Нет данных? Ответь _"нет часов"_',
    { parse_mode: 'Markdown' },
  );
}

// ─── Text handler: processes step count ───────────────────────────────────────

export async function stepsTextHandler(ctx: BotContext): Promise<void> {
  if (ctx.session.step !== 'awaiting_steps') return;

  const text = ctx.message?.text?.trim().toLowerCase();
  if (!text) return;

  ctx.session.step = null;
  const today = todayString();
  const { id: userId, start_date, goal_weight } = ctx.dbUser;

  // "нет часов" / "часы не носил" / "нет данных" — mark unavailable
  if (/нет|без|не носил|unavailable/.test(text)) {
    await supabase
      .from('daily_summary')
      .upsert(
        { user_id: userId, date: today, steps: null, steps_unavailable: true },
        { onConflict: 'user_id,date' },
      );

    await ctx.reply(
      '📵 Понял, часы не носил — шаги не записаны.\n' +
        'Постарайся завтра выйти хотя бы на 6 000 шагов — NEAT важен для дефицита.',
      { reply_markup: backToMenuKeyboard() },
    );
    return;
  }

  const steps = Number.parseInt(text.replace(/\s/g, ''), 10);

  if (Number.isNaN(steps) || steps < 0 || steps > 100_000) {
    await ctx.reply('❌ Не понял. Введи число шагов, например: *7500*', {
      parse_mode: 'Markdown',
    });
    ctx.session.step = 'awaiting_steps';
    return;
  }

  // Save steps + recompute daily status
  await supabase
    .from('daily_summary')
    .upsert(
      { user_id: userId, date: today, steps, steps_unavailable: false },
      { onConflict: 'user_id,date' },
    );

  // Recompute status with updated steps
  await foodService.recomputeDailySummary(userId, today, new Date(start_date));

  // Build feedback message
  let msg = `🚶 Шаги записаны: *${steps.toLocaleString('ru')}*\n\n`;

  if (steps < 4000) {
    msg +=
      '🚨 Меньше 4 000 шагов — очень низкий NEAT.\nЗавтра постарайся добрать хотя бы до 6 000.';
  } else if (steps < 6000) {
    msg += '⚠️ Чуть меньше нормы (6 000–8 000).\nЕсть возможность — выйди на 15–20 минут вечером.';
  } else if (steps >= 8000) {
    msg += '✅ Отлично! Норма выполнена с запасом.';
  } else {
    msg += '✅ В норме (6 000–8 000 шагов).';
  }

  // AI comment in parallel with reply
  const aiComment = await getAICommentary({
    trigger: 'food', // reuse 'food' trigger for daily context commentary
    userId,
    startDate: new Date(start_date),
    goalWeight: goal_weight,
    eventDetail: `записал ${steps.toLocaleString('ru')} шагов`,
  });

  if (aiComment) {
    msg += `\n\n🤖 _${aiComment}_`;
  }

  await ctx.reply(msg, { parse_mode: 'Markdown', reply_markup: backToMenuKeyboard() });
}
