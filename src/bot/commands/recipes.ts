import { InlineKeyboard } from 'grammy';
import { getAICommentary } from '../../services/ai.service';
import { buildDaySummaryText, foodService } from '../../services/food.service';
import {
  type RecipeIngredient,
  buildRecipeCard,
  calcRecipePer100,
  recipeService,
} from '../../services/recipe.service';
import { lookupAllItems } from '../../services/food-api.service';
import { getCycleInfo, getWeekNumber, todayString } from '../../utils/day-type';
import { parseFoodText } from '../../utils/parser';
import { backToMenuKeyboard } from '../keyboards/main';
import type { BotContext } from '../types';

// ─── Keyboards ────────────────────────────────────────────────────────────────

function recipesMenuKeyboard(hasRecipes: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (hasRecipes) kb.text('📋 Мои рецепты', 'recipe:list').row();
  kb.text('➕ Создать рецепт', 'recipe:create').row();
  kb.text('🏠 Меню', 'action:main_menu');
  return kb;
}

function recipeDetailKeyboard(recipeId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Записать порцию', `recipe:log:${recipeId}`)
    .row()
    .text('✏️ Редактировать', `recipe:edit:${recipeId}`)
    .text('🗑️ Удалить', `recipe:del:${recipeId}`)
    .row()
    .text('← Рецепты', 'recipe:list');
}

function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ Отмена', 'action:main_menu');
}

// ─── Callback: "📖 Рецепты" button ───────────────────────────────────────────

export async function recipesMenuHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.step = null;
  ctx.session.pendingRecipe = undefined;

  const recipes = await recipeService.getAll(ctx.dbUser.id);

  const text =
    recipes.length > 0
      ? `📖 *Рецепты* (${recipes.length})\n\nВыбери рецепт или создай новый.`
      : '📖 *Рецепты*\n\nУ тебя пока нет рецептов.\nСоздай первый — введи название и ингредиенты.';

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: recipesMenuKeyboard(recipes.length > 0),
    });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: recipesMenuKeyboard(recipes.length > 0) });
  }
}

// ─── Callback: list all recipes ───────────────────────────────────────────────

export async function recipeListHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const recipes = await recipeService.getAll(ctx.dbUser.id);

  if (recipes.length === 0) {
    await ctx.editMessageText('📖 Рецептов пока нет.', {
      reply_markup: recipesMenuKeyboard(false),
    });
    return;
  }

  const kb = new InlineKeyboard();
  for (const r of recipes.slice(0, 10)) {
    kb.text(`${r.name} (${r.kcal_per100} ккал/100г)`, `recipe:view:${r.id}`).row();
  }
  kb.text('➕ Создать рецепт', 'recipe:create').row();
  kb.text('🏠 Меню', 'action:main_menu');

  await ctx.editMessageText(`📋 *Мои рецепты* (${recipes.length}):`, {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

// ─── Callback: view recipe detail ─────────────────────────────────────────────

export async function recipeViewHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const recipeId = ctx.callbackQuery!.data!.replace('recipe:view:', '');
  const recipe = await recipeService.getById(recipeId);

  if (!recipe) {
    await ctx.reply('❌ Рецепт не найден.', { reply_markup: backToMenuKeyboard() });
    return;
  }

  await ctx.editMessageText(buildRecipeCard(recipe), {
    parse_mode: 'Markdown',
    reply_markup: recipeDetailKeyboard(recipe.id),
  });
}

// ─── Callback: start logging a portion ────────────────────────────────────────

export async function recipeLogHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const recipeId = ctx.callbackQuery!.data!.replace('recipe:log:', '');
  const recipe = await recipeService.getById(recipeId);

  if (!recipe) {
    await ctx.reply('❌ Рецепт не найден.', { reply_markup: backToMenuKeyboard() });
    return;
  }

  ctx.session.step = 'awaiting_recipe_portion';
  ctx.session.pendingRecipePortion = {
    recipeId: recipe.id,
    name: recipe.name,
    kcalPer100: recipe.kcal_per100,
    proteinPer100: recipe.protein_per100,
    fatPer100: recipe.fat_per100,
    carbsPer100: recipe.carbs_per100,
  };

  await ctx.reply(
    `📝 *${recipe.name}*\nНа 100г: ${recipe.kcal_per100} ккал · ${recipe.protein_per100}г белка\n\nСколько грамм съел?`,
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
  );
}

// ─── Text handler: portion grams ──────────────────────────────────────────────

export async function recipePortionHandler(ctx: BotContext): Promise<void> {
  if (ctx.session.step !== 'awaiting_recipe_portion') return;

  const text = ctx.message?.text?.trim().replace(',', '.');
  if (!text) return;

  const grams = Number.parseFloat(text);
  if (Number.isNaN(grams) || grams <= 0 || grams > 5000) {
    await ctx.reply('❌ Введи число грамм, например: *350*', { parse_mode: 'Markdown' });
    return;
  }

  const portion = ctx.session.pendingRecipePortion;
  if (!portion) {
    ctx.session.step = null;
    return;
  }

  ctx.session.step = null;
  ctx.session.pendingRecipePortion = undefined;

  const factor = grams / 100;
  const calories = Math.round(portion.kcalPer100 * factor);
  const protein = Math.round(portion.proteinPer100 * factor * 10) / 10;
  const fat = Math.round(portion.fatPer100 * factor * 10) / 10;
  const carbs = Math.round(portion.carbsPer100 * factor * 10) / 10;

  const { id: userId, start_date, goal_weight } = ctx.dbUser;
  const startDate = new Date(start_date);
  const today = todayString();
  const weekNumber = getWeekNumber(startDate, new Date());

  await Promise.all([
    foodService.saveFood({
      userId,
      startDate,
      foodName: `${portion.name} ${grams}г`,
      grams,
      calories,
      protein,
      fat,
      carbs,
      source: 'recipe',
    }),
    recipeService.incrementUseCount(portion.recipeId),
  ]);

  const [summary, aiComment] = await Promise.all([
    foodService.getDailySummary(userId, today),
    getAICommentary({
      trigger: 'food',
      userId,
      startDate,
      goalWeight: goal_weight,
      eventDetail: `записал: ${portion.name} ${grams}г — ${calories} ккал, ${protein}г белка`,
    }),
  ]);

  const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);

  let replyText =
    `✅ Записал: *${portion.name}* ${grams}г\n` + `${calories} ккал · ${protein}г белка\n\n`;

  if (summary) {
    replyText += buildDaySummaryText(summary, weekNumber, cycleNumber, isDietBreak);
  }
  if (aiComment) {
    replyText += `\n\n🤖 _${aiComment}_`;
  }

  await ctx.reply(replyText, {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard()
      .text('➕ Ещё приём', 'action:food_menu')
      .text('🏠 Меню', 'action:main_menu'),
  });
}

// ─── Callback: start create flow ──────────────────────────────────────────────

export async function recipeCreateHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.step = 'awaiting_recipe_name';
  ctx.session.pendingRecipe = undefined;

  await ctx.reply(
    '📖 *Новый рецепт*\n\nКак называется блюдо?\n_Например: Куриная грудка с гречкой_',
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
  );
}

// ─── Text handler: recipe name ────────────────────────────────────────────────

export async function recipeNameHandler(ctx: BotContext): Promise<void> {
  if (ctx.session.step !== 'awaiting_recipe_name') return;

  const name = ctx.message?.text?.trim();
  if (!name || name.length < 2) {
    await ctx.reply('❌ Слишком короткое название. Попробуй ещё раз.');
    return;
  }

  ctx.session.pendingRecipe = { name };
  ctx.session.step = 'awaiting_recipe_ingredients';

  await ctx.reply(
    `✅ Название: *${name}*\n\n` +
      'Введи ингредиенты и их вес в **сыром** виде.\n\n' +
      '_Пример: куриная грудка 400г, рис 200г, масло 10г_\n' +
      '_Или несколько строк:_\n' +
      '_куриная грудка 400г_\n_рис 200г_\n_масло 10г_',
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
  );
}

// ─── Text handler: recipe ingredients ────────────────────────────────────────

export async function recipeIngredientsHandler(ctx: BotContext): Promise<void> {
  if (ctx.session.step !== 'awaiting_recipe_ingredients') return;

  const text = ctx.message?.text?.trim();
  if (!text) return;

  const pending = ctx.session.pendingRecipe;
  if (!pending) {
    ctx.session.step = null;
    return;
  }

  const items = parseFoodText(text);

  if (items.length === 0) {
    await ctx.reply(
      '❌ Не понял. Введи продукты и граммы, например:\n_куриная грудка 400г, рис 200г_',
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
    );
    return;
  }

  if (items.length > 1) {
    await ctx.reply('🔍 Ищу данные о продуктах...');
  }

  const results = await lookupAllItems(items, ctx.dbUser.id);
  const found = results.filter((r) => r.nutrition !== null);
  const missing = results.filter((r) => r.nutrition === null);

  if (found.length === 0) {
    await ctx.reply(
      '❌ Не удалось найти КБЖУ ни для одного ингредиента.\n' +
        'Попробуй другие названия или добавь граммы.',
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
    );
    return;
  }

  const ingredients: RecipeIngredient[] = found.map((r) => ({
    name: r.item.name,
    grams: r.item.grams,
    calories: r.nutrition?.kcal ?? 0,
    protein: r.nutrition?.protein ?? 0,
    fat: r.nutrition?.fat ?? 0,
    carbs: r.nutrition?.carbs ?? 0,
  }));

  const { totalWeight, kcalPer100, proteinPer100, fatPer100, carbsPer100 } =
    calcRecipePer100(ingredients);

  // Build preview
  let preview = `📖 *${pending.name}*\n\n*Ингредиенты:*\n`;
  for (const ing of ingredients) {
    preview += `• ${ing.name} — ${ing.grams}г (${Math.round(ing.calories)} ккал · ${Math.round(ing.protein * 10) / 10}г белка)\n`;
  }
  preview += `\n*Итого:* ${totalWeight}г · ${Math.round(ingredients.reduce((s, i) => s + i.calories, 0))} ккал\n`;
  preview += `*На 100г:* ${kcalPer100} ккал · ${proteinPer100}г белка`;
  if (fatPer100 > 0) preview += ` · ${fatPer100}г жира`;
  if (carbsPer100 > 0) preview += ` · ${carbsPer100}г углеводов`;

  if (missing.length > 0) {
    preview += `\n\n⚠️ _Не нашёл данные для: ${missing.map((r) => r.item.name).join(', ')} — они не добавлены_`;
  }

  preview += '\n\nСохранить рецепт?';

  // Temporarily store ingredients in session as JSON string to avoid size issues
  // We save to DB directly on confirm
  ctx.session.pendingRecipe = {
    ...pending,
    // Encode ingredients into name field temporarily (will be decoded by confirmHandler)
  };

  // Store ingredients temporarily in pendingFood fields (reuse existing session space)
  // Actually, store as part of pendingRecipe by encoding to a special format
  // Since SessionData doesn't have an ingredients field, we'll confirm immediately
  // by saving in this handler and skipping a confirm step

  // Save directly since user can always edit later
  try {
    let recipe;
    if (pending.editingId) {
      recipe = await recipeService.update(pending.editingId, pending.name, ingredients);
    } else {
      recipe = await recipeService.create(ctx.dbUser.id, pending.name, ingredients);
    }

    ctx.session.step = null;
    ctx.session.pendingRecipe = undefined;

    const action = pending.editingId ? 'обновлён' : 'создан';

    await ctx.reply(`${preview}\n\n✅ Рецепт ${action}!`, {
      parse_mode: 'Markdown',
      reply_markup: recipeDetailKeyboard(recipe.id),
    });
  } catch (err) {
    console.error('[Recipe] Failed to save:', err);
    await ctx.reply('❌ Не удалось сохранить рецепт. Попробуй ещё раз.', {
      reply_markup: cancelKeyboard(),
    });
  }
}

// ─── Callback: edit recipe ────────────────────────────────────────────────────

export async function recipeEditHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const recipeId = ctx.callbackQuery!.data!.replace('recipe:edit:', '');
  const recipe = await recipeService.getById(recipeId);

  if (!recipe) {
    await ctx.reply('❌ Рецепт не найден.', { reply_markup: backToMenuKeyboard() });
    return;
  }

  ctx.session.step = 'awaiting_recipe_ingredients';
  ctx.session.pendingRecipe = { name: recipe.name, editingId: recipe.id };

  // Show current ingredients and ask to re-enter
  let currentText = `✏️ *Редактирование: ${recipe.name}*\n\n*Текущие ингредиенты:*\n`;
  for (const ing of recipe.ingredients) {
    currentText += `• ${ing.name} — ${ing.grams}г\n`;
  }
  currentText +=
    '\nВведи новые ингредиенты (заменят текущие):\n' +
    '_Пример: куриная грудка 400г, рис 200г, масло 10г_';

  await ctx.reply(currentText, { parse_mode: 'Markdown', reply_markup: cancelKeyboard() });
}

// ─── Callback: delete recipe ──────────────────────────────────────────────────

export async function recipeDeleteHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const recipeId = ctx.callbackQuery!.data!.replace('recipe:del:', '');
  const recipe = await recipeService.getById(recipeId);

  if (!recipe) {
    await ctx.reply('❌ Рецепт не найден.', { reply_markup: backToMenuKeyboard() });
    return;
  }

  const kb = new InlineKeyboard()
    .text('🗑️ Да, удалить', `recipe:del_confirm:${recipeId}`)
    .text('← Назад', `recipe:view:${recipeId}`);

  await ctx.editMessageText(`🗑️ Удалить рецепт *${recipe.name}*?`, {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

export async function recipeDeleteConfirmHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const recipeId = ctx.callbackQuery!.data!.replace('recipe:del_confirm:', '');
  await recipeService.delete(recipeId);

  await ctx.editMessageText('✅ Рецепт удалён.', { reply_markup: backToMenuKeyboard() });
}
