import type { BotContext } from '../types';
import { mainKeyboard } from '../keyboards/main';
import {
  getDayType,
  getDayTypeLabel,
  getTargetCalories,
  getWeekNumber,
  getCycleInfo,
  formatDateRu,
} from '../../utils/day-type';

export async function startCommand(ctx: BotContext): Promise<void> {
  const now = new Date();
  const startDate = new Date(ctx.dbUser.start_date);

  const dayType = getDayType(now);
  const weekNumber = getWeekNumber(startDate, now);
  const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);
  const targetCalories = getTargetCalories(dayType, weekNumber);

  let headerText = `Привет! Сегодня *${formatDateRu(now)}*\n`;
  headerText += `Тип дня: ${getDayTypeLabel(dayType)}\n`;

  if (isDietBreak) {
    headerText += `\n🔄 *Неделя ${weekNumber} — Diet Break!*\n`;
    headerText += `Цель на сегодня: *2200–2400 ккал* (восстановление)\n`;
    headerText += `\n_Это часть плана — не срыв. Тренировки продолжаются._`;
  } else {
    headerText += `Цель на сегодня: *${targetCalories} ккал*\n`;
    headerText += `📍 Неделя ${weekNumber}, Цикл ${cycleNumber}`;
  }

  // If called from a callback query — edit existing message; otherwise send new
  if (ctx.callbackQuery) {
    await ctx.editMessageText(headerText, {
      parse_mode: 'Markdown',
      reply_markup: mainKeyboard(),
    });
  } else {
    await ctx.reply(headerText, {
      parse_mode: 'Markdown',
      reply_markup: mainKeyboard(),
    });
  }
}
