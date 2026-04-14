import { supabase } from '../db/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecipeIngredient {
  name: string;
  grams: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface DbRecipe {
  id: string;
  user_id: string;
  name: string;
  ingredients: RecipeIngredient[];
  total_weight: number;
  kcal_per100: number;
  protein_per100: number;
  fat_per100: number;
  carbs_per100: number;
  use_count: number;
  created_at: string;
  updated_at: string;
}

// ─── Per-100g calculator ──────────────────────────────────────────────────────

export function calcRecipePer100(ingredients: RecipeIngredient[]): {
  totalWeight: number;
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
} {
  const totalWeight = Math.round(ingredients.reduce((s, i) => s + i.grams, 0));
  if (totalWeight === 0) {
    return { totalWeight: 0, kcalPer100: 0, proteinPer100: 0, fatPer100: 0, carbsPer100: 0 };
  }

  const totalKcal = ingredients.reduce((s, i) => s + i.calories, 0);
  const totalProtein = ingredients.reduce((s, i) => s + i.protein, 0);
  const totalFat = ingredients.reduce((s, i) => s + i.fat, 0);
  const totalCarbs = ingredients.reduce((s, i) => s + i.carbs, 0);

  const factor = 100 / totalWeight;
  return {
    totalWeight,
    kcalPer100: Math.round(totalKcal * factor),
    proteinPer100: Math.round(totalProtein * factor * 10) / 10,
    fatPer100: Math.round(totalFat * factor * 10) / 10,
    carbsPer100: Math.round(totalCarbs * factor * 10) / 10,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const recipeService = {
  /**
   * Fuzzy search by name — returns best match or null.
   * Used by food-api lookup chain.
   */
  async search(userId: string, query: string): Promise<DbRecipe | null> {
    const { data } = await supabase
      .from('recipes')
      .select('*')
      .eq('user_id', userId)
      .ilike('name', `%${query}%`)
      .order('use_count', { ascending: false })
      .limit(1);

    return (data?.[0] as DbRecipe) ?? null;
  },

  /** Returns all user recipes ordered by use_count descending. */
  async getAll(userId: string): Promise<DbRecipe[]> {
    const { data } = await supabase
      .from('recipes')
      .select('*')
      .eq('user_id', userId)
      .order('use_count', { ascending: false })
      .order('name', { ascending: true });

    return (data as DbRecipe[]) ?? [];
  },

  async getById(id: string): Promise<DbRecipe | null> {
    const { data } = await supabase.from('recipes').select('*').eq('id', id).single();
    return (data as DbRecipe) ?? null;
  },

  /** Creates a new recipe from ingredients, computing per-100g values. */
  async create(
    userId: string,
    name: string,
    ingredients: RecipeIngredient[],
  ): Promise<DbRecipe> {
    const { totalWeight, kcalPer100, proteinPer100, fatPer100, carbsPer100 } =
      calcRecipePer100(ingredients);

    const { data, error } = await supabase
      .from('recipes')
      .insert({
        user_id: userId,
        name,
        ingredients,
        total_weight: totalWeight,
        kcal_per100: kcalPer100,
        protein_per100: proteinPer100,
        fat_per100: fatPer100,
        carbs_per100: carbsPer100,
      })
      .select()
      .single();

    if (error) throw error;
    return data as DbRecipe;
  },

  /** Updates ingredients (and recomputes per-100g). Name can also be changed. */
  async update(
    id: string,
    name: string,
    ingredients: RecipeIngredient[],
  ): Promise<DbRecipe> {
    const { totalWeight, kcalPer100, proteinPer100, fatPer100, carbsPer100 } =
      calcRecipePer100(ingredients);

    const { data, error } = await supabase
      .from('recipes')
      .update({
        name,
        ingredients,
        total_weight: totalWeight,
        kcal_per100: kcalPer100,
        protein_per100: proteinPer100,
        fat_per100: fatPer100,
        carbs_per100: carbsPer100,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as DbRecipe;
  },

  async delete(id: string): Promise<void> {
    await supabase.from('recipes').delete().eq('id', id);
  },

  async incrementUseCount(id: string): Promise<void> {
    const { data } = await supabase
      .from('recipes')
      .select('use_count')
      .eq('id', id)
      .single();

    await supabase
      .from('recipes')
      .update({ use_count: (data?.use_count ?? 0) + 1 })
      .eq('id', id);
  },
};

// ─── Formatting ───────────────────────────────────────────────────────────────

export function buildRecipeCard(recipe: DbRecipe): string {
  const totalKcal = Math.round(
    recipe.ingredients.reduce((s, i) => s + i.calories, 0),
  );
  const totalProtein = Math.round(
    recipe.ingredients.reduce((s, i) => s + i.protein, 0) * 10,
  ) / 10;

  let text = `📖 *${recipe.name}*\n\n`;
  text += `*Ингредиенты:*\n`;
  for (const ing of recipe.ingredients) {
    text += `• ${ing.name} — ${ing.grams}г (${Math.round(ing.calories)} ккал · ${Math.round(ing.protein * 10) / 10}г белка)\n`;
  }
  text += `\n*Итого:* ${recipe.total_weight}г · ${totalKcal} ккал · ${totalProtein}г белка\n`;
  text += `*На 100г:* ${recipe.kcal_per100} ккал · ${recipe.protein_per100}г белка`;
  if (recipe.fat_per100 > 0) text += ` · ${recipe.fat_per100}г жира`;
  if (recipe.carbs_per100 > 0) text += ` · ${recipe.carbs_per100}г углеводов`;

  if (recipe.use_count > 0) {
    text += `\n_Записано ${recipe.use_count} раз_`;
  }

  return text;
}
