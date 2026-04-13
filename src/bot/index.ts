import { Bot, session } from 'grammy';
import type { BotContext, SessionData } from './types';
import { authMiddleware } from './middlewares/auth';
import { inputDetector } from './middlewares/input-detector';
import { startCommand } from './commands/start';
import { weightCallbackHandler, weightTextHandler } from './commands/weight';

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

// ─── Callback queries ─────────────────────────────────────────────────────────
bot.callbackQuery('action:log_weight', weightCallbackHandler);
bot.callbackQuery('action:main_menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await startCommand(ctx);
});

// ─── Free-text routing ────────────────────────────────────────────────────────
// inputDetector runs first to route by session step or auto-detect intent.
bot.on('message:text', inputDetector);

// Catch unhandled weight text (when step is active but message handler wasn't reached)
bot.on('message:text', weightTextHandler);

// ─── Error handler ────────────────────────────────────────────────────────────
bot.catch((err) => {
  console.error('Bot error:', err);
});

export default bot;
