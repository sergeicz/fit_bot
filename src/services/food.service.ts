import { supabase } from '../db/client';
import type { DayStatus, DbDailySummary } from '../db/types';
import {
  getDayType,
  getMealSlot,
  getTargetCalories,
  getWeekNumber,
  todayString,
} from '../utils/day-type';

interface SaveFoodParams {
  userId: string;
  startDate: Date;
  foodName: string;
  grams: number | null;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  source: string;
}

export const foodService = {
  /**
   * Inserts a food_log entry, updates data_compliance for the meal slot,
   * and recomputes the daily_summary totals and status.
   */
  async saveFood(params: SaveFoodParams): Promise<void> {
    const { userId, startDate, foodName, grams, calories, protein, fat, carbs, source } = params;
    const today = todayString();
    const now = new Date();
    const mealTime = getMealSlot(now);

    await supabase.from('food_logs').insert({
      user_id: userId,
      date: today,
      meal_time: mealTime,
      food_name: foodName,
      grams,
      calories,
      protein,
      fat,
      carbs,
      source,
    });

    // Mark the corresponding meal slot as logged in data_compliance
    if (mealTime) {
      const mealField =
        mealTime === '11:00'
          ? 'meal1_logged'
          : mealTime === '15:00'
            ? 'meal2_logged'
            : 'meal3_logged';

      await supabase
        .from('data_compliance')
        .upsert(
          { user_id: userId, date: today, [mealField]: true },
          { onConflict: 'user_id,date' },
        );
    }

    await foodService.recomputeDailySummary(userId, today, startDate);
  },

  /**
   * Re-sums all food_logs for the day and upserts daily_summary with fresh totals and status.
   * Preserves existing steps and weight fields.
   */
  async recomputeDailySummary(userId: string, date: string, startDate: Date): Promise<void> {
    const { data: logs } = await supabase
      .from('food_logs')
      .select('calories, protein, fat, carbs')
      .eq('user_id', userId)
      .eq('date', date);

    const totals = (logs ?? []).reduce(
      (acc, log) => ({
        calories: acc.calories + (Number(log.calories) || 0),
        protein: acc.protein + (Number(log.protein) || 0),
        fat: acc.fat + (Number(log.fat) || 0),
        carbs: acc.carbs + (Number(log.carbs) || 0),
      }),
      { calories: 0, protein: 0, fat: 0, carbs: 0 },
    );

    // Preserve existing steps (set via a separate flow)
    const { data: existing } = await supabase
      .from('daily_summary')
      .select('steps')
      .eq('user_id', userId)
      .eq('date', date)
      .single();

    const dayDate = new Date(date);
    const dayType = getDayType(dayDate);
    const weekNumber = getWeekNumber(startDate, dayDate);
    const targetCalories = getTargetCalories(dayType, weekNumber);

    const status = computeDayStatus(
      totals.calories,
      totals.protein,
      existing?.steps ?? 0,
      targetCalories,
    );

    await supabase.from('daily_summary').upsert(
      {
        user_id: userId,
        date,
        day_type: dayType,
        target_calories: targetCalories,
        total_calories: totals.calories,
        total_protein: totals.protein,
        total_fat: totals.fat,
        total_carbs: totals.carbs,
        status,
      },
      { onConflict: 'user_id,date' },
    );
  },

  async getDailySummary(userId: string, date: string): Promise<DbDailySummary | null> {
    const { data } = await supabase
      .from('daily_summary')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .single();
    return (data as DbDailySummary) ?? null;
  },

  async markMealSkipped(userId: string, date: string, mealNum: 1 | 2 | 3): Promise<void> {
    const field = `meal${mealNum}_skipped` as 'meal1_skipped' | 'meal2_skipped' | 'meal3_skipped';
    await supabase
      .from('data_compliance')
      .upsert({ user_id: userId, date, [field]: true }, { onConflict: 'user_id,date' });
  },
};

// ─── Day status helpers ───────────────────────────────────────────────────────

function computeDayStatus(
  totalCalories: number,
  totalProtein: number,
  steps: number,
  targetCalories: number,
): DayStatus {
  // Only warn about protein if something was logged
  if (totalProtein > 0 && totalProtein < 140) return 'critical_protein';
  if (totalCalories > targetCalories + 200) return 'over';
  if (totalCalories > 0 && totalCalories < targetCalories - 300) return 'under';
  if (Math.abs(totalCalories - targetCalories) <= 100 && totalProtein >= 155 && steps >= 6000) {
    return 'excellent';
  }
  return 'ok';
}

export function statusLabel(status: DayStatus | null): string {
  switch (status) {
    case 'excellent':
      return 'ОТЛИЧНЫЙ ✨';
    case 'ok':
      return 'НОРМА ✅';
    case 'over':
      return 'ПЕРЕБОР ❌';
    case 'under':
      return 'НЕДОЕЛ ⚠️';
    case 'critical_protein':
      return 'МАЛО БЕЛКА 🚨';
    default:
      return '—';
  }
}

export function buildDaySummaryText(
  summary: DbDailySummary,
  weekNumber: number,
  cycleNumber: number,
  isDietBreak = false,
): string {
  const target = summary.target_calories ?? 1600;
  const kcal = Math.round(summary.total_calories);
  const pct = kcal > 0 ? Math.round((kcal / target) * 100) : 0;

  let text = `📊 *Итог за сегодня*\n\n`;

  if (summary.weight) {
    text += `⚖️ Вес: *${summary.weight} кг*\n\n`;
  }

  text += `🍽️ Питание:\n`;

  if (kcal === 0) {
    text += `• Данные о питании не записаны\n`;
  } else {
    text += `• Ккал: *${kcal}* / ${target} (${pct}%)\n`;
    text += `• Белок: *${Math.round(summary.total_protein)}г* / 160г\n`;
    if (summary.total_fat > 0) text += `• Жиры: ${Math.round(summary.total_fat)}г\n`;
    if (summary.total_carbs > 0) text += `• Углеводы: ${Math.round(summary.total_carbs)}г\n`;
  }

  if (summary.steps) {
    text += `• Шаги: ${summary.steps.toLocaleString('ru')}\n`;
  }

  if (isDietBreak) {
    text += `\nДиет-брейк: цель *2200–2400 ккал* 🔄`;
    text += `\n\n📍 Неделя ${weekNumber} — Diet Break, Цикл ${cycleNumber}`;
  } else if (summary.status && kcal > 0) {
    text += `\nСтатус: *${statusLabel(summary.status)}*`;
    text += `\n\n📍 Неделя ${weekNumber}, Цикл ${cycleNumber}`;
  } else {
    text += `\n📍 Неделя ${weekNumber}, Цикл ${cycleNumber}`;
  }

  return text;
}
