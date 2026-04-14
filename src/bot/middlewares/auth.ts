import type { NextFunction } from 'grammy';
import { userService } from '../../services/user.service';
import type { BotContext } from '../types';

const ADMIN_TG_ID = 1093761679;

/**
 * Ensures the Telegram user exists in the database and attaches dbUser to ctx.
 * Blocks all non-admin users.
 */
export async function authMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  if (!ctx.from) return;

  if (ctx.from.id !== ADMIN_TG_ID) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: 'Иди нахуй' });
    } else {
      await ctx.reply('Иди нахуй');
    }
    return;
  }

  ctx.dbUser = await userService.getOrCreate({
    tg_id: ctx.from.id,
    username: ctx.from.username ?? null,
  });

  await next();
}
