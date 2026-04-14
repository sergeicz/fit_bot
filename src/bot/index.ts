import { Bot, session } from 'grammy';
import {
  dailySummaryHandler,
  foodCommand,
  foodConfirmHandler,
  foodManualEntryHandler,
  foodMenuHandler,
  skipMealHandler,
} from './commands/food';
import { startCommand } from './commands/start';
import { stepsCallbackHandler, stepsTextHandler } from './commands/steps';
import { weightCallbackHandler, weightTextHandler } from './commands/weight';
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
bot.callbackQuery('action:log_steps', stepsCallbackHandler);

// ─── Free-text routing ────────────────────────────────────────────────────────
// inputDetector runs first to route by session step or auto-detect intent.
bot.on('message:text', inputDetector);

// Catch unhandled weight text (when step is active but message handler wasn't reached)
bot.on('message:text', weightTextHandler);

// Steps text handler
bot.on('message:text', stepsTextHandler);

// ─── Error handler ────────────────────────────────────────────────────────────
bot.catch((err) => {
  console.error('Bot error:', err);
});

export default bot;
