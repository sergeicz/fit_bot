import { InlineKeyboard } from 'grammy';
import { bot } from '../bot';
import { supabase } from '../db/client';
import {
  formatDateRu,
  getCycleInfo,
  getDayType,
  getDayTypeLabel,
  getTargetCalories,
  getWeekNumber,
  todayString,
} from '../utils/day-type';

/**
 * 08:00 — morning reminder to weigh in.
 * Only sends if weight hasn't been logged yet today.
 */
export async function sendMorningReminder(): Promise<void> {
  const today = todayString();
  const now = new Date();

  // Fetch all users
  const { data: users } = await supabase.from('users').select('id, tg_id, start_date');
  if (!users) return;

  for (const user of users) {
    // Skip if weight already logged today
    const { data: compliance } = await supabase
      .from('data_compliance')
      .select('weight_logged')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    if (compliance?.weight_logged) continue;

    // Build context-aware message
    const startDate = new Date(user.start_date);
    const dayType = getDayType(now);
    const weekNumber = getWeekNumber(startDate, now);
    const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);
    const targetCalories = getTargetCalories(dayType, weekNumber);

    let text = `🌅 Доброе утро!\n\n`;
    text += `Сегодня *${formatDateRu(now)}*\n`;
    text += `Тип дня: ${getDayTypeLabel(dayType)}\n`;

    if (isDietBreak) {
      text += `\n🔄 *Неделя ${weekNumber} — Diet Break!*\n`;
      text += `Цель: *2200–2400 ккал* (восстановление гормонов)\n`;
      text += `\n_Это часть плана. Тренировки продолжаются._\n`;
    } else {
      text += `Цель на сегодня: *${targetCalories} ккал*\n`;
      text += `📍 Неделя ${weekNumber}, Цикл ${cycleNumber}\n`;
    }

    text += `\n⚖️ Не забудь взвеситься (натощак, до еды)!`;

    const keyboard = new InlineKeyboard()
      .text('⚖️ Внести вес', 'action:log_weight')
      .text('Напомни позже', 'weight:remind_later');

    try {
      await bot.api.sendMessage(user.tg_id, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });

      // Increment reminders_sent counter
      await supabase
        .from('data_compliance')
        .upsert(
          { user_id: user.id, date: today, reminders_sent: 1 },
          { onConflict: 'user_id,date' },
        );
    } catch (err) {
      console.error(`Failed to send morning reminder to ${user.tg_id}:`, err);
    }
  }
}

/**
 * 09:30 — repeat reminder if weight still not logged.
 */
export async function sendMorningRepeat(): Promise<void> {
  const today = todayString();

  const { data: users } = await supabase.from('users').select('id, tg_id');
  if (!users) return;

  for (const user of users) {
    const { data: compliance } = await supabase
      .from('data_compliance')
      .select('weight_logged, reminders_sent')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    if (compliance?.weight_logged) continue;

    const keyboard = new InlineKeyboard().text('⚖️ Внести вес', 'action:log_weight');

    try {
      await bot.api.sendMessage(
        user.tg_id,
        '⏰ Вес ещё не записан.\nЭто занимает 10 секунд — данные нужны для тренда.',
        { reply_markup: keyboard },
      );

      await supabase.from('data_compliance').upsert(
        {
          user_id: user.id,
          date: today,
          reminders_sent: (compliance?.reminders_sent ?? 0) + 1,
        },
        { onConflict: 'user_id,date' },
      );
    } catch (err) {
      console.error(`Failed to send 09:30 reminder to ${user.tg_id}:`, err);
    }
  }
}

/**
 * 11:00 — hard reminder if weight still not logged.
 */
export async function sendMorningHard(): Promise<void> {
  const today = todayString();

  const { data: users } = await supabase.from('users').select('id, tg_id');
  if (!users) return;

  for (const user of users) {
    const { data: compliance } = await supabase
      .from('data_compliance')
      .select('weight_logged, reminders_sent')
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    if (compliance?.weight_logged) continue;

    const keyboard = new InlineKeyboard()
      .text('⚖️ Внести вес', 'action:log_weight');

    try {
      await bot.api.sendMessage(
        user.tg_id,
        '🚨 *ВНИМАНИЕ!*\n\n' +
          'Вес не записан уже 2,5 часа.\n' +
          'Без ежедневного взвешивания тренд неточный — ты не увидишь реального прогресса.\n\n' +
          'Запиши прямо сейчас, даже если уже поел.',
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    } catch (err) {
      console.error(`Failed to send 11:00 hard reminder to ${user.tg_id}:`, err);
    }
  }
}
