import type { Context, SessionFlavor } from 'grammy';
import type { DbUser, PendingFoodItem } from '../db/types';

export interface SessionData {
  /** Current conversation step for multi-step flows */
  step:
    | 'awaiting_weight'
    | 'awaiting_weight_not_fasted' // user said "не натощак"
    | 'awaiting_food_text'
    | 'awaiting_food_nutrition' // food items parsed, waiting for kcal + protein
    | 'awaiting_food_grams' // user selected a frequent food, now we need grams
    | 'awaiting_food_confirm'
    | 'awaiting_steps'
    | null;

  /** Food items parsed and waiting for user confirmation */
  pendingFood?: PendingFoodItem[];

  /** Name of frequent food selected, waiting for grams input */
  pendingFrequentFood?: string;
}

export type BotContext = Context &
  SessionFlavor<SessionData> & {
    dbUser: DbUser;
  };
