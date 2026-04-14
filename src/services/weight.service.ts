import { supabase } from '../db/client';
import type { DayStatus, DbWeight } from '../db/types';
import {
  getCycleInfo,
  getDayType,
  getTargetCalories,
  getWeekNumber,
  todayString,
} from '../utils/day-type';

interface SaveWeightParams {
  userId: string;
  date: string;
  weight: number;
  isFasted: boolean;
  startDate: Date;
}

export const weightService = {
  /** Saves (or overwrites) today's weight entry. */
  async saveWeight(params: SaveWeightParams): Promise<void> {
    const { userId, date, weight, isFasted, startDate } = params;

    await supabase
      .from('weights')
      .upsert(
        { user_id: userId, date, weight, is_fasted: isFasted },
        { onConflict: 'user_id,date' },
      );

    // Update daily_summary.weight with correct cycle-based target calories
    const dayDate = new Date(date);
    const dayType = getDayType(dayDate);
    const weekNumber = getWeekNumber(startDate, dayDate);
    await supabase.from('daily_summary').upsert(
      {
        user_id: userId,
        date,
        weight,
        day_type: dayType,
        target_calories: getTargetCalories(dayType, weekNumber),
      },
      { onConflict: 'user_id,date' },
    );

    // Mark weight as logged in compliance table
    await supabase
      .from('data_compliance')
      .upsert(
        { user_id: userId, date, weight_logged: true, weight_fasted: isFasted },
        { onConflict: 'user_id,date' },
      );
  },

  /**
   * Returns last N fasted weight entries sorted by date descending.
   * Non-fasted weights are stored but excluded from trend calculations.
   */
  async getWeightHistory(userId: string, limit = 7): Promise<DbWeight[]> {
    const { data } = await supabase
      .from('weights')
      .select('*')
      .eq('user_id', userId)
      .eq('is_fasted', true)
      .order('date', { ascending: false })
      .limit(limit);

    return (data as DbWeight[]) ?? [];
  },

  /**
   * 7-day trend: difference between most recent and oldest fasted weight.
   * Returns null if fewer than 2 data points.
   */
  async getWeightTrend(userId: string): Promise<number | null> {
    const history = await weightService.getWeightHistory(userId, 7);
    if (history.length < 2) return null;

    const latest = history[0].weight;
    const oldest = history[history.length - 1].weight;
    return Number((latest - oldest).toFixed(1));
  },

  /** Returns today's weight entry if exists. */
  async getTodayWeight(userId: string): Promise<DbWeight | null> {
    const today = todayString();
    const { data } = await supabase
      .from('weights')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    return (data as DbWeight) ?? null;
  },

  /** Recomputes and updates daily_summary status based on current totals. */
  async recomputeDayStatus(userId: string, date: string): Promise<void> {
    const { data: summary } = await supabase
      .from('daily_summary')
      .select('total_calories, total_protein, steps, target_calories')
      .eq('user_id', userId)
      .eq('date', date)
      .single();

    if (!summary) return;

    const { total_calories, total_protein, steps, target_calories } = summary;
    const target = target_calories ?? 1600;
    let status: DayStatus;

    if (total_protein < 140) {
      status = 'critical_protein';
    } else if (total_calories > target + 200) {
      status = 'over';
    } else if (total_calories < target - 300) {
      status = 'under';
    } else if (
      Math.abs(total_calories - target) <= 100 &&
      total_protein >= 155 &&
      (steps ?? 0) >= 6000
    ) {
      status = 'excellent';
    } else {
      status = 'ok';
    }

    await supabase.from('daily_summary').update({ status }).eq('user_id', userId).eq('date', date);
  },
};

/** Formats the weight confirmation message after saving. */
export function buildWeightConfirmText(params: {
  weight: number;
  isFasted: boolean;
  trend: number | null;
  weekNumber: number;
  cycleNumber: number;
  isDietBreak: boolean;
  goalWeight: number;
}): string {
  const { weight, isFasted, trend, weekNumber, cycleNumber, isDietBreak, goalWeight } = params;

  const fastedNote = isFasted ? '' : ' _(не натощак)_';
  let text = `✅ Записал: *${weight} кг*${fastedNote}\n\n`;

  if (trend !== null) {
    const trendSign = trend > 0 ? '+' : '';
    const trendEmoji = trend < 0 ? '📉' : trend > 0 ? '📈' : '➡️';
    text += `${trendEmoji} Тренд за 7 дней: ${trendSign}${trend} кг\n`;
  }

  if (isDietBreak) {
    text += `📍 Неделя ${weekNumber} — *Diet Break* 🔄\n`;
    text += 'Цель на неделю: 2200–2400 ккал (восстановление гормонов)\n';
    text += '\n⚠️ Вес может вырасти на 1–2 кг — это вода и гликоген, не жир. Норма!';
  } else {
    const remaining = Math.max(0, weight - goalWeight);
    text += `📍 Неделя ${weekNumber}, Цикл ${cycleNumber}\n`;
    text += `🎯 До цели: ещё ${remaining.toFixed(1)} кг`;
  }

  return text;
}
