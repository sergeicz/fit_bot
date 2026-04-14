// ─── Types ────────────────────────────────────────────────────────────────────

export interface DaySummaryForCalc {
  date: string;
  total_calories: number;
  total_protein: number;
  target_calories: number | null;
  steps: number | null;
  status: string | null;
  weight: number | null;
}

// ─── Deficit & fat loss ───────────────────────────────────────────────────────

/** Daily deficit in kcal (positive = deficit, negative = surplus). */
export function dailyDeficit(actual: number, target: number): number {
  return target - actual;
}

/**
 * Sum of daily deficits across logged days.
 * Days without food (total_calories === 0) are excluded — no data ≠ zero intake.
 */
export function weeklyDeficit(summaries: DaySummaryForCalc[]): number {
  return summaries
    .filter((d) => d.total_calories > 0)
    .reduce((sum, d) => sum + dailyDeficit(d.total_calories, d.target_calories ?? 1700), 0);
}

/**
 * Theoretical fat loss from energy deficit.
 * 1 kg body fat ≈ 7 700 kcal.
 */
export function deficitToFatLoss(totalDeficit: number): number {
  return Number((Math.max(0, totalDeficit) / 7700).toFixed(2));
}

// ─── Averages ─────────────────────────────────────────────────────────────────

/** Average of non-null, non-zero values. Returns null if no data. */
export function average(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null && v > 0);
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// ─── Adherence ────────────────────────────────────────────────────────────────

/** % of logged days where protein >= 160 g. */
export function proteinAdherence(summaries: DaySummaryForCalc[]): number {
  const logged = summaries.filter((d) => d.total_protein > 0);
  if (logged.length === 0) return 0;
  return Math.round((logged.filter((d) => d.total_protein >= 160).length / logged.length) * 100);
}

/** % of days with steps logged where steps >= 6000. */
export function stepsAdherence(summaries: DaySummaryForCalc[]): number {
  const logged = summaries.filter((d) => d.steps != null);
  if (logged.length === 0) return 0;
  return Math.round((logged.filter((d) => (d.steps ?? 0) >= 6000).length / logged.length) * 100);
}

/** Count of days with a given status. */
export function countByStatus(summaries: DaySummaryForCalc[], status: string): number {
  return summaries.filter((d) => d.status === status).length;
}
