import { InlineKeyboard } from 'grammy';
import { bot } from '../bot';
import { supabase } from '../db/client';
import { getAICommentary } from '../services/ai.service';
import { buildDaySummaryText, foodService } from '../services/food.service';
import { getCycleInfo, getWeekNumber, todayString } from '../utils/day-type';

// ─── 13:00 — weight panic + meal 1 reminder ──────────────────────────────────

export async function sendMealAndWeightPanic13(): Promise<void> {
  const today = todayString();

  const { data: users } = await supabase.from('users').select('id, tg_id, start_date');
  if (!users) return;

  for (const user of users) {
    const { data: compliance } = await supabase
      .from('data_compliance')
      .select('weight_logged, meal1_logged, meal1_skipped, reminders_sent')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    const weightMissing = !compliance?.weight_logged;
    const meal1Missing = !compliance?.meal1_logged && !compliance?.meal1_skipped;

    if (!weightMissing && !meal1Missing) continue;

    let text = '';
    const keyboard = new InlineKeyboard();

    if (weightMissing) {
      text += '🚨 Уже 13:00 — вес всё ещё не записан!\n';
      text += 'Без веса тренд неточный. Взвесься сейчас, даже если уже поел.\n\n';
      keyboard.text('⚖️ Внести вес', 'action:log_weight').row();
    }

    if (meal1Missing) {
      text += '🍽️ Приём 1 (11:00) не записан.\n';
      text += 'Не помнишь точно — запиши примерно, это лучше чем ничего.';
      keyboard.text('🍽️ Записать', 'action:food_menu').text('Пропустил', 'food:skip_meal1');
    }

    try {
      await bot.api.sendMessage(user.tg_id, text.trim(), {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });

      await supabase.from('data_compliance').upsert(
        {
          user_id: user.id,
          date: today,
          reminders_sent: (compliance?.reminders_sent ?? 0) + 1,
        },
        { onConflict: 'user_id,date' },
      );
    } catch (err) {
      console.error(`[13:00 cron] Failed for tg_id=${user.tg_id}:`, err);
    }
  }
}

// ─── 14:00 — meal 1 repeat ────────────────────────────────────────────────────

export async function sendMeal1Repeat14(): Promise<void> {
  const today = todayString();

  const { data: users } = await supabase.from('users').select('id, tg_id');
  if (!users) return;

  for (const user of users) {
    const { data: compliance } = await supabase
      .from('data_compliance')
      .select('meal1_logged, meal1_skipped')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    if (compliance?.meal1_logged || compliance?.meal1_skipped) continue;

    const keyboard = new InlineKeyboard()
      .text('🍽️ Записать', 'action:food_menu')
      .text('Пропустил', 'food:skip_meal1');

    try {
      await bot.api.sendMessage(
        user.tg_id,
        '⏰ Приём 1 (11:00) ещё не записан.\n' +
          'Не помнишь точно — запиши примерно. Это важно для подсчёта дефицита.',
        { reply_markup: keyboard },
      );
    } catch (err) {
      console.error(`[14:00 cron] Failed for tg_id=${user.tg_id}:`, err);
    }
  }
}

// ─── 16:30 — meal 2 reminder ─────────────────────────────────────────────────

export async function sendMeal2Reminder1630(): Promise<void> {
  const today = todayString();

  const { data: users } = await supabase.from('users').select('id, tg_id');
  if (!users) return;

  for (const user of users) {
    const { data: compliance } = await supabase
      .from('data_compliance')
      .select('meal2_logged, meal2_skipped')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    if (compliance?.meal2_logged || compliance?.meal2_skipped) continue;

    const keyboard = new InlineKeyboard()
      .text('🍽️ Записать приём 2', 'action:food_menu')
      .text('Пропускаю', 'food:skip_meal2');

    try {
      await bot.api.sendMessage(
        user.tg_id,
        '🍽️ Время приёма 2!\n' + 'Окно питания работает до 19:00. Запиши еду сейчас.',
        { reply_markup: keyboard },
      );
    } catch (err) {
      console.error(`[16:30 cron] Failed for tg_id=${user.tg_id}:`, err);
    }
  }
}

// ─── 17:30 — meal 2 repeat ────────────────────────────────────────────────────

export async function sendMeal2Repeat1730(): Promise<void> {
  const today = todayString();

  const { data: users } = await supabase.from('users').select('id, tg_id');
  if (!users) return;

  for (const user of users) {
    const { data: compliance } = await supabase
      .from('data_compliance')
      .select('meal2_logged, meal2_skipped')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    if (compliance?.meal2_logged || compliance?.meal2_skipped) continue;

    const keyboard = new InlineKeyboard()
      .text('🍽️ Записать', 'action:food_menu')
      .text('Пропустил', 'food:skip_meal2');

    try {
      await bot.api.sendMessage(
        user.tg_id,
        '⏰ Приём 2 (15:00) всё ещё не записан.\n' +
          'Запиши хотя бы примерно — осталось 1,5 часа до закрытия окна.',
        { reply_markup: keyboard },
      );
    } catch (err) {
      console.error(`[17:30 cron] Failed for tg_id=${user.tg_id}:`, err);
    }
  }
}

// ─── 19:30 — meal 3 reminder (window closes in 30 min) ───────────────────────

export async function sendMeal3Reminder1930(): Promise<void> {
  const today = todayString();

  const { data: users } = await supabase.from('users').select('id, tg_id');
  if (!users) return;

  for (const user of users) {
    const { data: compliance } = await supabase
      .from('data_compliance')
      .select('meal3_logged, meal3_skipped')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    if (compliance?.meal3_logged || compliance?.meal3_skipped) continue;

    const keyboard = new InlineKeyboard()
      .text('🍽️ Записать приём 3', 'action:food_menu')
      .text('Пропускаю', 'food:skip_meal3');

    try {
      await bot.api.sendMessage(
        user.tg_id,
        '⏰ *Окно питания закрывается через 30 минут!*\n\n' +
          'Последний приём (18:30) — успей записать еду.\n' +
          'После 19:00 — только вода и электролиты.',
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (err) {
      console.error(`[19:30 cron] Failed for tg_id=${user.tg_id}:`, err);
    }
  }
}

// ─── 23:00 — steps reminder ───────────────────────────────────────────────────

export async function sendStepsReminder23(): Promise<void> {
  const today = todayString();

  const { data: users } = await supabase.from('users').select('id, tg_id');
  if (!users) return;

  for (const user of users) {
    // Skip if steps already logged or marked unavailable
    const { data: summary } = await supabase
      .from('daily_summary')
      .select('steps, steps_unavailable')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    if (summary?.steps != null || summary?.steps_unavailable) continue;

    const keyboard = new InlineKeyboard()
      .text('🚶 Внести шаги', 'action:log_steps')
      .text('Нет часов', 'steps:unavailable');

    try {
      await bot.api.sendMessage(
        user.tg_id,
        '🚶 *Шаги за сегодня не записаны.*\n\n' +
          'Внеси количество шагов — это влияет на статус дня и точность анализа.\n' +
          'Норма: 6 000–8 000 шагов.',
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (err) {
      console.error(`[23:00 cron] Failed for tg_id=${user.tg_id}:`, err);
    }
  }
}

// ─── 20:00 — day summary + meal 3 panic ──────────────────────────────────────

export async function sendDaySummary20(): Promise<void> {
  const today = todayString();

  const { data: users } = await supabase.from('users').select('id, tg_id, start_date, goal_weight');
  if (!users) return;

  for (const user of users) {
    const startDate = new Date(user.start_date);
    const weekNumber = getWeekNumber(startDate, new Date());
    const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);

    // Recompute summary + fetch compliance + call AI in parallel
    await foodService.recomputeDailySummary(user.id, today, startDate);

    const [summary, complianceRes, aiComment] = await Promise.all([
      foodService.getDailySummary(user.id, today),
      supabase
        .from('data_compliance')
        .select('meal3_logged, meal3_skipped')
        .eq('user_id', user.id)
        .eq('date', today)
        .single(),
      getAICommentary({
        trigger: 'eod',
        userId: user.id,
        startDate,
        goalWeight: user.goal_weight,
      }),
    ]);

    const compliance = complianceRes.data;
    let text = '';
    const keyboard = new InlineKeyboard();

    if (summary) {
      text += buildDaySummaryText(summary, weekNumber, cycleNumber, isDietBreak);
    } else {
      text += '📊 *Итог за сегодня*\n\nДанных нет — завтра запишем с самого утра.';
      text += `\n\n📍 Неделя ${weekNumber}, Цикл ${cycleNumber}`;
    }

    const meal3Missing = !compliance?.meal3_logged && !compliance?.meal3_skipped;

    if (meal3Missing) {
      text += '\n\n🍽️ Приём 3 (18:30) не записан — добавь сейчас или отметь пропуск.';
      keyboard.text('🍽️ Записать', 'action:food_menu').text('Пропустил', 'food:skip_meal3').row();
    }

    if (aiComment) {
      text += `\n\n🤖 _${aiComment}_`;
    }

    keyboard.text('🏠 Меню', 'action:main_menu');

    try {
      await bot.api.sendMessage(user.tg_id, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error(`[20:00 cron] Failed for tg_id=${user.tg_id}:`, err);
    }
  }
}
