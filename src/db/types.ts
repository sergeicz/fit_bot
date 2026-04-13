export interface DbUser {
  id: string;
  tg_id: number;
  username: string | null;
  start_weight: number;
  goal_weight: number;
  start_date: string; // 'YYYY-MM-DD'
  current_cycle: number;
  created_at: string;
}

export interface DbWeight {
  id: string;
  user_id: string;
  date: string;
  weight: number;
  is_fasted: boolean;
  logged_at: string;
}

export interface DbFoodLog {
  id: string;
  user_id: string;
  date: string;
  meal_time: string | null;
  food_name: string;
  grams: number | null;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  source: string | null;
  logged_at: string;
}

export interface DbFrequentFood {
  id: string;
  user_id: string;
  food_name: string;
  last_grams: number | null;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  use_count: number;
  last_used: string | null;
}

export interface DbWorkout {
  id: string;
  user_id: string;
  date: string;
  type: string;
  exercises: Exercise[] | null;
  notes: string | null;
  duration_min: number | null;
  logged_at: string;
}

export interface Exercise {
  name: string;
  sets: number;
  reps: number;
  weight_kg: number;
}

export interface DbDailySummary {
  id: string;
  user_id: string;
  date: string;
  day_type: string | null;
  target_calories: number | null;
  total_calories: number;
  total_protein: number;
  total_fat: number;
  total_carbs: number;
  steps: number | null;
  steps_unavailable: boolean;
  weight: number | null;
  status: DayStatus | null;
}

export type DayStatus = 'excellent' | 'ok' | 'over' | 'under' | 'critical_protein';

export interface DbDataCompliance {
  id: string;
  user_id: string;
  date: string;
  weight_logged: boolean;
  weight_fasted: boolean;
  meal1_logged: boolean;
  meal1_skipped: boolean;
  meal2_logged: boolean;
  meal2_skipped: boolean;
  meal3_logged: boolean;
  meal3_skipped: boolean;
  reminders_sent: number;
}

// Pending food item before user confirms
export interface PendingFoodItem {
  food_name: string;
  grams: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  source: string;
}
