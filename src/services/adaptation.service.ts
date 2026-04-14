import { supabase } from '../db/client';
import { average } from '../utils/calculator';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdaptationSignalId = 'weight_plateau' | 'low_steps' | 'kcal_gap';

export interface AdaptationSignal {
  id: AdaptationSignalId;
  label: string;
  detail: string;
}

export interface AdaptationResult {
  signals: AdaptationSignal[];
  /** Non-null when 2+ signals fire simultaneously — ready to send to user. */
  recommendation: string | null;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const PLATEAU_DAYS = 10; // min consecutive days to call it a plateau
const PLATEAU_SPREAD_KG = 0.5; // max weight variation to count as plateau
const STEPS_DAYS = 7; // lookback window for steps
const STEPS_MIN_DATA = 3; // need at least this many logged days
const STEPS_ALERT_AVG = 5000; // avg below this → signal
const KCAL_GAP_DAYS = 7; // lookback window for calorie gap
const KCAL_GAP_MIN_DATA = 4; // need at least this many logged days
const KCAL_GAP_THRESHOLD = 300; // avg deficit > target by this much → possible tracking gap

// ─── Signal checkers ─────────────────────────────────────────────────────────

async function checkWeightPlateau(userId: string): Promise<AdaptationSignal | null> {
  const { data } = await supabase
    .from('weights')
    .select('date, weight')
    .eq('user_id', userId)
    .eq('is_fasted', true)
    .order('date', { ascending: false })
    .limit(PLATEAU_DAYS + 4); // fetch a few extra in case of gaps

  if (!data || data.length < PLATEAU_DAYS) return null;

  const recent = data.slice(0, PLATEAU_DAYS);
  const weights = recent.map((r) => r.weight);
  const spread = Math.max(...weights) - Math.min(...weights);

  if (spread >= PLATEAU_SPREAD_KG) return null;

  return {
    id: 'weight_plateau',
    label: 'Вес стоит',
    detail: `${PLATEAU_DAYS} дней без изменений (разброс ${spread.toFixed(1)} кг)`,
  };
}

async function checkLowSteps(userId: string): Promise<AdaptationSignal | null> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STEPS_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const { data } = await supabase
    .from('daily_summary')
    .select('steps')
    .eq('user_id', userId)
    .gte('date', cutoffStr)
    .not('steps', 'is', null);

  if (!data || data.length < STEPS_MIN_DATA) return null;

  const avg = average(data.map((d) => d.steps)) ?? 0;
  if (avg >= STEPS_ALERT_AVG) return null;

  return {
    id: 'low_steps',
    label: 'Низкий NEAT',
    detail: `Средние шаги за ${data.length} дней: ${Math.round(avg).toLocaleString('ru')} (норма 6 000–8 000)`,
  };
}

async function checkKcalGap(userId: string): Promise<AdaptationSignal | null> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KCAL_GAP_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const { data } = await supabase
    .from('daily_summary')
    .select('total_calories, target_calories')
    .eq('user_id', userId)
    .gte('date', cutoffStr)
    .gt('total_calories', 0); // only days where food was logged

  if (!data || data.length < KCAL_GAP_MIN_DATA) return null;

  const avgActual = average(data.map((d) => d.total_calories)) ?? 0;
  const avgTarget = average(data.map((d) => d.target_calories)) ?? 1700;
  const gap = avgTarget - avgActual;

  if (gap < KCAL_GAP_THRESHOLD) return null;

  return {
    id: 'kcal_gap',
    label: 'Большой дефицит',
    detail: `Ешь в среднем ${Math.round(avgActual)} ккал при цели ${Math.round(avgTarget)} — дефицит ${Math.round(gap)} ккал/день`,
  };
}

// ─── Recommendation builder ───────────────────────────────────────────────────

function buildRecommendation(signals: AdaptationSignal[]): string {
  const ids = signals.map((s) => s.id);

  // Weight plateau is always the lead signal — tailor advice by what else fired
  if (ids.includes('weight_plateau') && ids.includes('low_steps')) {
    return (
      '⚠️ *Признаки адаптации:* вес стоит и шаги низкие.\n\n' +
      'Это классика: тело снизило расход энергии. Шаги — самый простой рычаг.\n' +
      'Попробуй 2–3 дня по 8 000–10 000 шагов — это часто сдвигает плато без изменения питания.'
    );
  }

  if (ids.includes('weight_plateau') && ids.includes('kcal_gap')) {
    return (
      '⚠️ *Признаки адаптации:* вес стоит и большой дефицит.\n\n' +
      'Слишком агрессивный дефицит может тормозить похудение — тело снижает метаболизм.\n' +
      'Попробуй 2–3 дня добавить 150–200 ккал за счёт углеводов и посмотри на динамику.'
    );
  }

  if (ids.includes('low_steps') && ids.includes('kcal_gap')) {
    return (
      '⚠️ *Два тревожных сигнала:* низкий NEAT и большой дефицит.\n\n' +
      'Убедись что ккал записаны точно — возможно, реальный дефицит меньше.\n' +
      'Также добавь ходьбы: 6 000+ шагов в день поддерживают метаболизм.'
    );
  }

  // 3 signals
  return (
    '🚨 *Признаки адаптации по всем фронтам.*\n\n' +
    'Вес стоит + низкий NEAT + большой дефицит — пора на короткий diet break (5–7 дней).\n' +
    'Подними ккал до 2 000–2 200, продолжи тренировки. Это разгонит метаболизм и потом снова пойдёт вниз.'
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks adaptation signals for a user.
 * Returns recommendation text when 2+ signals fire simultaneously.
 * Designed to be called after weight logging and in weekly cron.
 */
export async function checkAdaptation(userId: string): Promise<AdaptationResult> {
  const [plateau, steps, kcal] = await Promise.all([
    checkWeightPlateau(userId),
    checkLowSteps(userId),
    checkKcalGap(userId),
  ]);

  const signals = [plateau, steps, kcal].filter((s): s is AdaptationSignal => s !== null);

  if (signals.length < 2) {
    return { signals, recommendation: null };
  }

  return { signals, recommendation: buildRecommendation(signals) };
}
