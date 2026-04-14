import { supabase } from '../db/client';
import type { ParsedFoodItem } from '../utils/parser';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FoodNutrition {
  name: string; // normalized name to save
  kcal: number; // for given grams
  protein: number;
  fat: number;
  carbs: number;
  kcalPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  source: 'cache' | 'openfoodfacts' | 'ai';
}

export interface FoodSearchResult {
  item: ParsedFoodItem;
  nutrition: FoodNutrition | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcForGrams(
  per100g: Omit<FoodNutrition, 'kcal' | 'protein' | 'fat' | 'carbs' | 'name' | 'source'>,
  grams: number,
) {
  const factor = grams / 100;
  return {
    kcal: Math.round(per100g.kcalPer100g * factor),
    protein: Math.round(per100g.proteinPer100g * factor * 10) / 10,
    fat: Math.round(per100g.fatPer100g * factor * 10) / 10,
    carbs: Math.round(per100g.carbsPer100g * factor * 10) / 10,
  };
}

// ─── Source 1: user's frequent foods cache ────────────────────────────────────

async function searchCache(userId: string, name: string): Promise<FoodNutrition | null> {
  const { data } = await supabase
    .from('frequent_foods')
    .select('food_name, calories, protein, fat, carbs, last_grams')
    .eq('user_id', userId)
    .ilike('food_name', `%${name}%`)
    .order('use_count', { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row || !row.calories) return null;

  const per100g = {
    kcalPer100g: row.calories,
    proteinPer100g: row.protein ?? 0,
    fatPer100g: row.fat ?? 0,
    carbsPer100g: row.carbs ?? 0,
  };

  return { name: row.food_name, source: 'cache', ...per100g, ...calcForGrams(per100g, 100) };
}

// ─── Source 2: Open Food Facts ────────────────────────────────────────────────

async function searchOpenFoodFacts(name: string): Promise<FoodNutrition | null> {
  try {
    // Append "raw" to bias search toward uncooked/unprocessed products
    const query = `${name} raw`;
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=1&action=process&search_simple=1&page_size=5&fields=product_name,nutriments`;

    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      products: {
        product_name?: string;
        nutriments?: {
          'energy-kcal_100g'?: number;
          proteins_100g?: number;
          fat_100g?: number;
          carbohydrates_100g?: number;
        };
      }[];
    };

    // Find first product with usable kcal data
    for (const product of data.products ?? []) {
      const n = product.nutriments;
      const kcal = n?.['energy-kcal_100g'];
      if (!kcal || kcal <= 0) continue;

      const per100g = {
        kcalPer100g: Math.round(kcal),
        proteinPer100g: n?.proteins_100g ?? 0,
        fatPer100g: n?.fat_100g ?? 0,
        carbsPer100g: n?.carbohydrates_100g ?? 0,
      };

      return {
        name: product.product_name || name,
        source: 'openfoodfacts',
        ...per100g,
        ...calcForGrams(per100g, 100),
      };
    }
  } catch {
    // timeout or network error — fall through
  }
  return null;
}

// ─── Source 3: Groq AI estimation ────────────────────────────────────────────

async function estimateWithAI(name: string): Promise<FoodNutrition | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'Ты диетолог. Отвечай ТОЛЬКО JSON без пояснений и markdown.',
          },
          {
            role: 'user',
            content: `КБЖУ для "${name}" в СЫРОМ виде на 100г (не варёный, не жареный). Формат: {"kcal":0,"protein":0,"fat":0,"carbs":0}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 60,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const raw = data.choices[0].message.content.trim();

    // Extract JSON even if model wraps it
    const match = raw.match(/\{[^}]+\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as {
      kcal: number;
      protein: number;
      fat: number;
      carbs: number;
    };
    if (!parsed.kcal || parsed.kcal <= 0) return null;

    const per100g = {
      kcalPer100g: Math.round(parsed.kcal),
      proteinPer100g: parsed.protein ?? 0,
      fatPer100g: parsed.fat ?? 0,
      carbsPer100g: parsed.carbs ?? 0,
    };

    return {
      name,
      source: 'ai',
      ...per100g,
      ...calcForGrams(per100g, 100),
    };
  } catch {
    return null;
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Searches for nutrition data for a food item.
 * Priority: user cache → Open Food Facts → AI estimate
 * Applies the given grams to compute actual kcal/protein/fat/carbs.
 */
export async function lookupFoodNutrition(
  item: ParsedFoodItem,
  userId: string,
): Promise<FoodNutrition | null> {
  const name = item.name.toLowerCase().trim();
  const grams = item.grams;

  const found =
    (await searchCache(userId, name)) ??
    (await searchOpenFoodFacts(name)) ??
    (await estimateWithAI(name));

  if (!found) return null;

  // Recalculate for the actual grams requested
  const factor = grams / 100;
  return {
    ...found,
    name: item.name, // keep user's original name
    kcal: Math.round(found.kcalPer100g * factor),
    protein: Math.round(found.proteinPer100g * factor * 10) / 10,
    fat: Math.round(found.fatPer100g * factor * 10) / 10,
    carbs: Math.round(found.carbsPer100g * factor * 10) / 10,
  };
}

/**
 * Searches all parsed items in parallel.
 */
export async function lookupAllItems(
  items: ParsedFoodItem[],
  userId: string,
): Promise<FoodSearchResult[]> {
  return Promise.all(
    items.map((item) => lookupFoodNutrition(item, userId).then((n) => ({ item, nutrition: n }))),
  );
}

/**
 * Saves found nutrition to frequent_foods cache.
 * Updates use_count if already exists.
 */
export async function cacheFood(userId: string, result: FoodNutrition): Promise<void> {
  const existing = await supabase
    .from('frequent_foods')
    .select('id, use_count')
    .eq('user_id', userId)
    .ilike('food_name', result.name)
    .single();

  if (existing.data) {
    await supabase
      .from('frequent_foods')
      .update({
        use_count: (existing.data.use_count ?? 0) + 1,
        last_used: new Date().toISOString().split('T')[0],
        calories: result.kcalPer100g,
        protein: result.proteinPer100g,
        fat: result.fatPer100g,
        carbs: result.carbsPer100g,
      })
      .eq('id', existing.data.id);
  } else {
    await supabase.from('frequent_foods').insert({
      user_id: userId,
      food_name: result.name,
      calories: result.kcalPer100g,
      protein: result.proteinPer100g,
      fat: result.fatPer100g,
      carbs: result.carbsPer100g,
      use_count: 1,
      last_used: new Date().toISOString().split('T')[0],
    });
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<FoodNutrition['source'], string> = {
  cache: '📁',
  openfoodfacts: '🌍',
  ai: '🤖~',
};

export function formatFoodSearchResults(results: FoodSearchResult[]): string {
  const found = results.filter((r) => r.nutrition !== null);
  const missing = results.filter((r) => r.nutrition === null);

  let text = '';

  if (found.length > 0) {
    text += '📝 *Нашёл:*\n';
    for (const r of found) {
      if (!r.nutrition) continue;
      const n = r.nutrition;
      const label = SOURCE_LABEL[n.source];
      text += `• *${r.item.name}* ${r.item.grams}г ${label}\n`;
      text += `  ${n.kcal} ккал · ${n.protein}г белка`;
      if (n.fat > 0 || n.carbs > 0) text += ` · ${n.fat}г жира · ${n.carbs}г углеводов`;
      text += `\n  _на 100г: ${n.kcalPer100g} ккал · ${n.proteinPer100g}г белка_\n`;
    }
  }

  if (missing.length > 0) {
    text += `\n❓ *Не нашёл:* ${missing.map((r) => r.item.name).join(', ')}\n`;
  }

  if (found.length > 1) {
    const total = found.reduce(
      (acc, r) => ({
        kcal: acc.kcal + (r.nutrition?.kcal ?? 0),
        protein: acc.protein + (r.nutrition?.protein ?? 0),
      }),
      { kcal: 0, protein: 0 },
    );
    text += `\n*Итого: ${total.kcal} ккал, ${Math.round(total.protein * 10) / 10}г белка*\n`;
  }

  return text.trim();
}
