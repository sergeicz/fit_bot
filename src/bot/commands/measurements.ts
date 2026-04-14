import { InlineKeyboard } from 'grammy';
import { weightService } from '../../services/weight.service';
import {
  buildMeasurementResultText,
  buildMeasurementsHistoryText,
  calcNavyBodyFat,
  measurementsService,
} from '../../services/measurements.service';
import { todayString } from '../../utils/day-type';
import { backToMenuKeyboard } from '../keyboards/main';
import type { BotContext } from '../types';

function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ Отмена', 'action:main_menu');
}

// ─── Callback: "📏 Замеры" button ─────────────────────────────────────────────

export async function measurementsMenuHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const history = await measurementsService.getLast(ctx.dbUser.id, 8);

  const kb = new InlineKeyboard()
    .text('📝 Внести замеры', 'action:log_measurements')
    .row();

  if (history.length > 0) {
    kb.text('📋 История', 'action:measurements_history').row();
  }

  kb.text('🏠 Меню', 'action:main_menu');

  const lastText =
    history.length > 0
      ? `Последние: ${new Date(history[0].date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} — талия ${history[0].waist} см${history[0].body_fat !== null ? `, жир ${history[0].body_fat}%` : ''}`
      : 'Замеров пока нет.';

  await ctx.editMessageText(
    `📏 *Замеры тела*\n\n${lastText}\n\n_Снимай раз в неделю, утром натощак, после туалета._`,
    { parse_mode: 'Markdown', reply_markup: kb },
  );
}

// ─── Callback: start logging flow ─────────────────────────────────────────────

export async function logMeasurementsHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  // If height not set — ask first
  if (!ctx.dbUser.height_cm) {
    ctx.session.step = 'awaiting_measurements_height';
    await ctx.reply(
      '📏 Для расчёта % жира по формуле ВМС США нужен твой рост.\n\nВведи рост в сантиметрах:\n_Пример: 182_',
      { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
    );
    return;
  }

  ctx.session.step = 'awaiting_measurements_waist';
  await ctx.reply(
    '📏 *Замеры*\n\nВведи обхват талии в сантиметрах:\n_Измеряй на уровне пупка, выдохни воздух_\n_Пример: 89_',
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
  );
}

// ─── Callback: show history ───────────────────────────────────────────────────

export async function measurementsHistoryHandler(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const history = await measurementsService.getLast(ctx.dbUser.id, 8);
  const text = buildMeasurementsHistoryText(history);

  const kb = new InlineKeyboard()
    .text('📝 Внести замеры', 'action:log_measurements')
    .row()
    .text('🏠 Меню', 'action:main_menu');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
}

// ─── Step: height (one-time) ──────────────────────────────────────────────────

export async function measurementsHeightHandler(ctx: BotContext): Promise<void> {
  if (ctx.session.step !== 'awaiting_measurements_height') return;

  const text = ctx.message?.text?.trim().replace(',', '.');
  const height = Number.parseFloat(text ?? '');

  if (Number.isNaN(height) || height < 140 || height > 220) {
    await ctx.reply('❌ Введи рост числом от 140 до 220 см, например: *182*', {
      parse_mode: 'Markdown',
    });
    return;
  }

  await measurementsService.setUserHeight(ctx.dbUser.id, height);
  ctx.dbUser.height_cm = height; // update in-context so next step sees it

  ctx.session.step = 'awaiting_measurements_waist';
  await ctx.reply(
    `✅ Рост сохранён: *${height} см*\n\nВведи обхват талии (см):\n_Измеряй на уровне пупка, выдохни воздух_`,
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
  );
}

// ─── Step: waist ──────────────────────────────────────────────────────────────

export async function measurementsWaistHandler(ctx: BotContext): Promise<void> {
  if (ctx.session.step !== 'awaiting_measurements_waist') return;

  const text = ctx.message?.text?.trim().replace(',', '.');
  const waist = Number.parseFloat(text ?? '');

  if (Number.isNaN(waist) || waist < 50 || waist > 200) {
    await ctx.reply('❌ Введи обхват талии числом от 50 до 200 см, например: *89*', {
      parse_mode: 'Markdown',
    });
    return;
  }

  ctx.session.pendingMeasurementWaist = waist;
  ctx.session.step = 'awaiting_measurements_neck';

  await ctx.reply(
    `Талия: *${waist} см* ✅\n\nВведи обхват шеи (см):\n_Измеряй под кадыком_\n_Пример: 38_`,
    { parse_mode: 'Markdown', reply_markup: cancelKeyboard() },
  );
}

// ─── Step: neck → calculate & save ───────────────────────────────────────────

export async function measurementsNeckHandler(ctx: BotContext): Promise<void> {
  if (ctx.session.step !== 'awaiting_measurements_neck') return;

  const text = ctx.message?.text?.trim().replace(',', '.');
  const neck = Number.parseFloat(text ?? '');

  if (Number.isNaN(neck) || neck < 20 || neck > 80) {
    await ctx.reply('❌ Введи обхват шеи числом от 20 до 80 см, например: *38*', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const waist = ctx.session.pendingMeasurementWaist;
  if (!waist) {
    ctx.session.step = null;
    await ctx.reply('❌ Данные устарели. Начни замеры заново.', {
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  ctx.session.step = null;
  ctx.session.pendingMeasurementWaist = undefined;

  const { id: userId, height_cm } = ctx.dbUser;
  if (!height_cm) {
    await ctx.reply('❌ Рост не задан. Нажми «📏 Замеры» и введи рост.', {
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }

  // Get current weight for lean mass calculation
  const trend = await weightService.getWeightTrend(userId);
  const weightHistory = await weightService.getWeightHistory(userId, 1);
  const currentWeight = weightHistory[0]?.weight ?? null;

  const result = calcNavyBodyFat(waist, neck, height_cm, currentWeight ?? 85);

  const today = todayString();
  await measurementsService.save(userId, today, waist, neck, result.bodyFat, result.leanMass);

  const history = await measurementsService.getLast(userId, 8);

  const replyText = buildMeasurementResultText(waist, neck, result, history, currentWeight);

  const kb = new InlineKeyboard()
    .text('📋 История', 'action:measurements_history')
    .row()
    .text('🏠 Меню', 'action:main_menu');

  await ctx.reply(replyText, { parse_mode: 'Markdown', reply_markup: kb });
}
