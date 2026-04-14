import type { Context, SessionFlavor } from 'grammy';
import type { DbUser, PendingFoodItem } from '../db/types';

export interface SessionData {
  /** Current conversation step for multi-step flows */
  step:
    | 'awaiting_weight'
    | 'awaiting_weight_not_fasted'
    | 'awaiting_food_text'
    | 'awaiting_food_nutrition'
    | 'awaiting_food_grams'
    | 'awaiting_food_confirm'
    | 'awaiting_steps'
    | 'awaiting_recipe_name'
    | 'awaiting_recipe_ingredients'
    | 'awaiting_recipe_portion'
    | 'awaiting_search_grams'
    | null;

  /** Food items parsed and waiting for user confirmation */
  pendingFood?: PendingFoodItem[];

  /** Name of frequent food selected, waiting for grams input */
  pendingFrequentFood?: string;

  /** Recipe being created or edited */
  pendingRecipe?: {
    name: string;
    editingId?: string; // set when editing existing recipe
  };

  /** Food search results waiting for user to pick one */
  pendingSearchResults?: Array<{
    name: string;
    kcalPer100g: number;
    proteinPer100g: number;
    fatPer100g: number;
    carbsPer100g: number;
    source: 'cache' | 'openfoodfacts' | 'ai';
  }>;

  /** Search result selected by user, waiting for grams input */
  pendingSearchResult?: {
    name: string;
    kcalPer100g: number;
    proteinPer100g: number;
    fatPer100g: number;
    carbsPer100g: number;
    source: 'cache' | 'openfoodfacts' | 'ai';
  };

  /** Recipe selected from list, waiting for portion grams */
  pendingRecipePortion?: {
    recipeId: string;
    name: string;
    kcalPer100: number;
    proteinPer100: number;
    fatPer100: number;
    carbsPer100: number;
  };
}

export type BotContext = Context &
  SessionFlavor<SessionData> & {
    dbUser: DbUser;
  };
