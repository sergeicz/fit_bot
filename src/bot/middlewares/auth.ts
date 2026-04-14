import type { NextFunction } from 'grammy';
import { userService } from '../../services/user.service';
import type { BotContext } from '../types';

/**
 * Ensures the Telegram user exists in the database and attaches dbUser to ctx.
 * Updates skips (channels, etc.) where ctx.from is absent.
 */
export async function authMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  if (!ctx.from) {
    return; // ignore channel posts and anonymous messages
  }

  ctx.dbUser = await userService.getOrCreate({
    tg_id: ctx.from.id,
    username: ctx.from.username ?? null,
  });

  await next();
}
