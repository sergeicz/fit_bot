import { supabase } from '../db/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DbMeasurement {
  id: string;
  user_id: string;
  date: string;
  waist: number;
  neck: number;
  chest: number | null;
  hips: number | null;
  body_fat: number | null;
  lean_mass: number | null;
}

export interface BodyFatResult {
  bodyFat: number;       // %
  leanMass: number;      // kg
  fatMass: number;       // kg
  category: string;
  emoji: string;
}

// ─── US Navy body fat formula (male) ─────────────────────────────────────────
// % = 495 / (1.0324 − 0.19077 × log10(waist − neck) + 0.15456 × log10(height)) − 450

export function calcNavyBodyFat(
  waistCm: number,
  neckCm: number,
  heightCm: number,
  weightKg: number,
): BodyFatResult {
  const diff = waistCm - neckCm;
  if (diff <= 0) {
    // Guard: waist must exceed neck
    return { bodyFat: 0, leanMass: weightKg, fatMass: 0, category: 'Ошибка', emoji: '❌' };
  }

  const bodyFat =
    Math.round(
      (495 / (1.0324 - 0.19077 * Math.log10(diff) + 0.15456 * Math.log10(heightCm)) - 450) * 10,
    ) / 10;

  const fatMass = Math.round((weightKg * bodyFat) / 100 * 10) / 10;
  const leanMass = Math.round((weightKg - fatMass) * 10) / 10;

  let category: string;
  let emoji: string;
  if (bodyFat < 6) {
    category = 'Минимально необходимый';
    emoji = '⚡';
  } else if (bodyFat < 14) {
    category = 'Атлетический';
    emoji = '🏆';
  } else if (bodyFat < 18) {
    category = 'Подтянутый';
    emoji = '💪';
  } else if (bodyFat < 25) {
    category = 'Средний';
    emoji = '✅';
  } else if (bodyFat < 32) {
    category = 'Выше нормы';
    emoji = '⚠️';
  } else {
    category = 'Высокий';
    emoji = '🔴';
  }

  return { bodyFat, leanMass, fatMass, category, emoji };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const measurementsService = {
  async save(
    userId: string,
    date: string,
    waist: number,
    neck: number,
    bodyFat: number,
    leanMass: number,
  ): Promise<DbMeasurement> {
    const { data, error } = await supabase
      .from('measurements')
      .upsert(
        { user_id: userId, date, waist, neck, body_fat: bodyFat, lean_mass: leanMass },
        { onConflict: 'user_id,date' },
      )
      .select()
      .single();

    if (error) throw error;
    return data as DbMeasurement;
  },

  async getLast(userId: string, limit = 8): Promise<DbMeasurement[]> {
    const { data } = await supabase
      .from('measurements')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(limit);

    return (data as DbMeasurement[]) ?? [];
  },

  async setUserHeight(userId: string, heightCm: number): Promise<void> {
    await supabase.from('users').update({ height_cm: heightCm }).eq('id', userId);
  },
};

// ─── Formatting ───────────────────────────────────────────────────────────────

export function buildMeasurementResultText(
  waist: number,
  neck: number,
  result: BodyFatResult,
  history: DbMeasurement[],
  currentWeight: number | null,
): string {
  let text = '📏 *Замеры записаны*\n\n';
  text += `Талия: *${waist} см* · Шея: *${neck} см*\n\n`;
  text += `${result.emoji} Жир: *${result.bodyFat}%* — ${result.category}\n`;
  text += `💪 Мышечная масса: *${result.leanMass} кг*\n`;
  if (currentWeight) {
    text += `🔴 Жировая масса: *${result.fatMass} кг*\n`;
  }

  // Show delta vs last measurement
  if (history.length >= 2) {
    const prev = history[1]; // [0] is the one we just saved
    if (prev.body_fat !== null) {
      const fatDelta = Math.round((result.bodyFat - prev.body_fat) * 10) / 10;
      const sign = fatDelta > 0 ? '+' : '';
      const deltaEmoji = fatDelta < 0 ? '📉' : fatDelta > 0 ? '📈' : '➡️';
      const daysBetween = Math.round(
        (new Date(history[0].date).getTime() - new Date(prev.date).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      text += `\n${deltaEmoji} За ${daysBetween} дн.: ${sign}${fatDelta}% жира`;
      if (prev.lean_mass !== null) {
        const leanDelta = Math.round((result.leanMass - prev.lean_mass) * 10) / 10;
        const leanSign = leanDelta > 0 ? '+' : '';
        text += `, ${leanSign}${leanDelta} кг мышц`;
      }
    }
  }

  return text;
}

export function buildMeasurementsHistoryText(history: DbMeasurement[]): string {
  if (history.length === 0) {
    return '📏 *История замеров*\n\nЗамеров пока нет. Нажми «📏 Замеры» чтобы внести первые.';
  }

  let text = '📏 *История замеров*\n\n';
  for (const m of history) {
    const date = new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    text += `*${date}* — талия ${m.waist} см, шея ${m.neck} см`;
    if (m.body_fat !== null) text += ` → *${m.body_fat}% жира*`;
    if (m.lean_mass !== null) text += `, ${m.lean_mass} кг мышц`;
    text += '\n';
  }

  return text;
}
