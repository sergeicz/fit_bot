export type DayType = 'workout' | 'rest' | 'light';

export interface CycleInfo {
  weekNumber: number;
  cycleNumber: number;
  isDietBreak: boolean;
}

const WORKOUT_DAYS = new Set([1, 3, 5]); // Mon=1, Wed=3, Fri=5

// ─── Day type ─────────────────────────────────────────────────────────────────

export function getDayType(date: Date): DayType {
  const dow = date.getDay(); // 0=Sun, 1=Mon … 6=Sat
  if (WORKOUT_DAYS.has(dow)) return 'workout';
  if (dow === 0) return 'light'; // Sunday — light activity day
  return 'rest';
}

export function getDayTypeLabel(dayType: DayType): string {
  switch (dayType) {
    case 'workout':
      return '🏋️ Тренировка';
    case 'rest':
      return '😴 Отдых';
    case 'light':
      return '🚶 Лёгкая активность';
  }
}

// ─── Calories ─────────────────────────────────────────────────────────────────

interface CycleCalories {
  workout: number;
  rest: number;
  light: number;
}

/**
 * Target calories by cycle.
 * Gradually decreasing to prevent full metabolic adaptation.
 *
 * Cycle 1 (weeks  1–4):  1850 / 1650 / 1750
 * Cycle 2 (weeks  5–8):  1800 / 1600 / 1700
 * Cycle 3 (weeks  9–12): 1750 / 1550 / 1650
 * Diet Break (week 13):  2300 all days
 * Cycle 4 (weeks 14–17): 1800 / 1600 / 1700
 * Cycle 5 (weeks 18–21): 1750 / 1600 / 1700
 * Cycle 6 (weeks 22–24): 1700 / 1550 / 1600
 */
const CYCLE_CALORIES: Record<number, CycleCalories> = {
  1: { workout: 1850, rest: 1650, light: 1750 },
  2: { workout: 1800, rest: 1600, light: 1700 },
  3: { workout: 1750, rest: 1550, light: 1650 },
  4: { workout: 1800, rest: 1600, light: 1700 },
  5: { workout: 1750, rest: 1600, light: 1700 },
  6: { workout: 1700, rest: 1550, light: 1600 },
};

export function getTargetCalories(dayType: DayType, weekNumber: number): number {
  const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);
  if (isDietBreak) return 2300;

  const calories = CYCLE_CALORIES[cycleNumber] ?? CYCLE_CALORIES[6];
  switch (dayType) {
    case 'workout':
      return calories.workout;
    case 'rest':
      return calories.rest;
    case 'light':
      return calories.light;
  }
}

// ─── Week & cycle calculation ─────────────────────────────────────────────────

/** Returns the Monday of the week containing the given date */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

/** Week number since start_date (week 1 = first week). Returns 1 minimum. */
export function getWeekNumber(startDate: Date, currentDate: Date): number {
  const startMonday = getWeekStart(startDate);
  const currentMonday = getWeekStart(currentDate);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const diff = Math.floor((currentMonday.getTime() - startMonday.getTime()) / msPerWeek) + 1;
  return Math.max(1, diff);
}

/** Returns cycle info for a given week number */
export function getCycleInfo(weekNumber: number): CycleInfo {
  if (weekNumber <= 4) return { weekNumber, cycleNumber: 1, isDietBreak: false };
  if (weekNumber <= 8) return { weekNumber, cycleNumber: 2, isDietBreak: false };
  if (weekNumber <= 12) return { weekNumber, cycleNumber: 3, isDietBreak: false };
  if (weekNumber === 13) return { weekNumber, cycleNumber: 3, isDietBreak: true };
  if (weekNumber <= 17) return { weekNumber, cycleNumber: 4, isDietBreak: false };
  if (weekNumber <= 21) return { weekNumber, cycleNumber: 5, isDietBreak: false };
  return { weekNumber, cycleNumber: 6, isDietBreak: false };
}

// ─── Expected weight corridor per cycle ──────────────────────────────────────

export function getCycleWeightCorridor(cycleNumber: number): string {
  switch (cycleNumber) {
    case 1:
      return '90–92 кг';
    case 2:
      return '86–88 кг';
    case 3:
      return '82–84 кг';
    case 4:
      return '80–82 кг';
    case 5:
      return '77–80 кг';
    case 6:
      return '76–78 кг';
    default:
      return '76–78 кг';
  }
}

// ─── Intermittent fasting window ──────────────────────────────────────────────

/** Returns true if current time is inside the eating window (11:00–19:00) */
export function isEatingWindow(date: Date): boolean {
  const hour = date.getHours();
  const minutes = date.getMinutes();
  const totalMinutes = hour * 60 + minutes;
  return totalMinutes >= 11 * 60 && totalMinutes < 19 * 60;
}

/** Which meal slot does this time fall into? Returns null if outside window */
export function getMealSlot(date: Date): '11:00' | '15:00' | '18:30' | null {
  const hour = date.getHours();
  const minutes = date.getMinutes();
  const totalMinutes = hour * 60 + minutes;

  if (totalMinutes >= 10 * 60 + 30 && totalMinutes < 14 * 60) return '11:00';
  if (totalMinutes >= 14 * 60 && totalMinutes < 17 * 60) return '15:00';
  if (totalMinutes >= 17 * 60 && totalMinutes < 20 * 60) return '18:30';
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Today's date as 'YYYY-MM-DD' string */
export function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

export const DAY_NAMES_RU = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];

export const DAY_NAMES_SHORT_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** Format date as 'Пн, 13 апреля' */
export function formatDateRu(date: Date): string {
  const months = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];
  const dayShort = DAY_NAMES_SHORT_RU[date.getDay()];
  return `${dayShort}, ${date.getDate()} ${months[date.getMonth()]}`;
}
