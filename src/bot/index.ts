import { Bot, session } from 'grammy';
import { supabase } from '../db/client';
import { todayString } from '../utils/day-type';
import {
  dailySummaryHandler,
  foodCommand,
  foodConfirmHandler,
  foodManualEntryHandler,
  foodMenuHandler,
  skipMealHandler,
} from './commands/food';
import { startCommand } from './commands/start';
import {
  recipeCreateHandler,
  recipeDeleteConfirmHandler,
  recipeDeleteHandler,
  recipeEditHandler,
  recipeIngredientsHandler,
  recipeListHandler,
  recipeLogHandler,
  recipeNameHandler,
  recipePortionHandler,
  recipeViewHandler,
  recipesMenuHandler,
} from './commands/recipes';
import { foodSearchUseCallback } from './commands/food-search';
import {
  logMeasurementsHandler,
  measurementsHeightHandler,
  measurementsHistoryHandler,
  measurementsMenuHandler,
  measurementsNeckHandler,
  measurementsWaistHandler,
} from './commands/measurements';
import { stepsCallbackHandler, stepsTextHandler } from './commands/steps';
import { weightCallbackHandler, weightTextHandler } from './commands/weight';
import { backToMenuKeyboard } from './keyboards/main';
import { authMiddleware } from './middlewares/auth';
import { inputDetector } from './middlewares/input-detector';
import type { BotContext, SessionData } from './types';

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('Missing BOT_TOKEN environment variable');

export const bot = new Bot<BotContext>(token);

// ─── Session ──────────────────────────────────────────────────────────────────
// Using in-memory session for Stage 1. Swap to Supabase-backed session later.
bot.use(
  session<SessionData, BotContext>({
    initial: (): SessionData => ({ step: null }),
  }),
);

// ─── Auth ─────────────────────────────────────────────────────────────────────
bot.use(authMiddleware);

// ─── Commands ─────────────────────────────────────────────────────────────────
bot.command('start', startCommand);
bot.command('menu', startCommand);
bot.command('food', foodCommand);

// ─── Callback queries ─────────────────────────────────────────────────────────
bot.callbackQuery('action:log_weight', weightCallbackHandler);
bot.callbackQuery('action:main_menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = null;
  ctx.session.pendingFood = undefined;
  await startCommand(ctx);
});
bot.callbackQuery('action:food_menu', foodMenuHandler);
bot.callbackQuery('action:daily_summary', dailySummaryHandler);
bot.callbackQuery('food:confirm', foodConfirmHandler);
bot.callbackQuery('food:manual_entry', foodManualEntryHandler);
bot.callbackQuery('food:skip_meal1', (ctx) => skipMealHandler(ctx, 1));
bot.callbackQuery('food:skip_meal2', (ctx) => skipMealHandler(ctx, 2));
bot.callbackQuery('food:skip_meal3', (ctx) => skipMealHandler(ctx, 3));
bot.callbackQuery(/^food_search:use:/, foodSearchUseCallback);
bot.callbackQuery('action:measurements_menu', measurementsMenuHandler);
bot.callbackQuery('action:log_measurements', logMeasurementsHandler);
bot.callbackQuery('action:measurements_history', measurementsHistoryHandler);
bot.callbackQuery('action:log_steps', stepsCallbackHandler);
bot.callbackQuery('action:recipes_menu', recipesMenuHandler);
bot.callbackQuery('recipe:list', recipeListHandler);
bot.callbackQuery('recipe:create', recipeCreateHandler);
bot.callbackQuery(/^recipe:view:/, recipeViewHandler);
bot.callbackQuery(/^recipe:log:/, recipeLogHandler);
bot.callbackQuery(/^recipe:edit:/, recipeEditHandler);
bot.callbackQuery(/^recipe:del:/, recipeDeleteHandler);
bot.callbackQuery(/^recipe:del_confirm:/, recipeDeleteConfirmHandler);
bot.callbackQuery('steps:unavailable', async (ctx) => {
  await ctx.answerCallbackQuery();
  const { id: userId } = ctx.dbUser;
  const today = todayString();
  await supabase
    .from('daily_summary')
    .upsert(
      { user_id: userId, date: today, steps: null, steps_unavailable: true },
      { onConflict: 'user_id,date' },
    );
  await ctx.editMessageText('📵 Понял, часы не носил — шаги не записаны.', {
    reply_markup: backToMenuKeyboard(),
  });
});

// ─── Free-text routing ────────────────────────────────────────────────────────
// inputDetector runs first to route by session step or auto-detect intent.
bot.on('message:text', inputDetector);

// Catch unhandled weight text (when step is active but message handler wasn't reached)
bot.on('message:text', weightTextHandler);

// Steps text handler
bot.on('message:text', stepsTextHandler);

// Recipe multi-step text handlers
bot.on('message:text', recipeNameHandler);
bot.on('message:text', recipeIngredientsHandler);
bot.on('message:text', recipePortionHandler);

// ─── Error handler ────────────────────────────────────────────────────────────
bot.catch((err) => {
  console.error('Bot error:', err);
});

export default bot;
