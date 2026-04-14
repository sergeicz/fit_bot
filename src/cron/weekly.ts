import { InlineKeyboard } from 'grammy';
import { bot } from '../bot';
import { supabase } from '../db/client';
import { checkAdaptation } from '../services/adaptation.service';
import { getAICommentary } from '../services/ai.service';
import { statusLabel } from '../services/food.service';
import { measurementsService } from '../services/measurements.service';
import {
  average,
  countByStatus,
  deficitToFatLoss,
  proteinAdherence,
  stepsAdherence,
  weeklyDeficit,
} from '../utils/calculator';
import { DAY_NAMES_SHORT_RU, getCycleInfo, getWeekNumber, todayString } from '../utils/day-type';

// ─── Helper ───────────────────────────────────────────────────────────────────

function formatDay(dateStr: string): string {
  const d = new Date(dateStr);
  const day = DAY_NAMES_SHORT_RU[d.getDay()];
  const date = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  return `${day} ${date}`;
}

// ─── Weekly report ────────────────────────────────────────────────────────────

export async function sendWeeklyReport(): Promise<void> {
  const today = todayString();

  // Last 7 days (today inclusive)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Previous 7 days (for comparison)
  const prevCutoff = new Date();
  prevCutoff.setDate(prevCutoff.getDate() - 13);
  const prevCutoffStr = prevCutoff.toISOString().split('T')[0];
  const prevEndStr = new Date(cutoff.getTime() - 86400000).toISOString().split('T')[0];

  const { data: users } = await supabase.from('users').select('id, tg_id, start_date, goal_weight');
  if (!users) return;

  for (const user of users) {
    const startDate = new Date(user.start_date);
    const weekNumber = getWeekNumber(startDate, new Date());
    const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);

    // Fetch current + previous week summaries + adaptation in parallel
    const [currentRes, prevRes, adaptation, aiComment, lastMeasurement] = await Promise.all([
      supabase
        .from('daily_summary')
        .select('date, total_calories, total_protein, target_calories, steps, status, weight')
        .eq('user_id', user.id)
        .gte('date', cutoffStr)
        .lte('date', today)
        .order('date', { ascending: true }),

      supabase
        .from('daily_summary')
        .select('total_calories, total_protein, target_calories, steps, status, weight')
        .eq('user_id', user.id)
        .gte('date', prevCutoffStr)
        .lte('date', prevEndStr),

      checkAdaptation(user.id),

      getAICommentary({
        trigger: 'eod',
        userId: user.id,
        startDate,
        goalWeight: user.goal_weight,
        eventDetail:
          'Конец недели — дай краткий анализ итогов недели и главную задачу на следующую.',
      }),

      measurementsService.getLast(user.id, 1),
    ]);

    const days = currentRes.data ?? [];
    const prevDays = prevRes.data ?? [];

    if (days.length === 0) continue;

    // ── Header ──
    let text = isDietBreak
      ? `📊 *НЕДЕЛЬНЫЙ ОТЧЁТ — Неделя ${weekNumber} (Diet Break)*\n\n`
      : `📊 *НЕДЕЛЬНЫЙ ОТЧЁТ — Неделя ${weekNumber}, Цикл ${cycleNumber}*\n\n`;

    // ── 7-day table ──
    text += '```\n';
    text += 'День     | Вес   | Ккал | Белок | Шаги\n';
    text += '---------|-------|------|-------|------\n';

    for (const d of days) {
      const day = formatDay(d.date);
      const weight = d.weight ? `${d.weight.toFixed(1)}` : '  —  ';
      const kcal = d.total_calories > 0 ? Math.round(d.total_calories).toString() : ' — ';
      const protein = d.total_protein > 0 ? `${Math.round(d.total_protein)}г` : ' — ';
      const steps = d.steps != null ? Math.round(d.steps / 100) * 100 : null;
      const stepsStr = steps != null ? steps.toLocaleString('ru') : '  —  ';
      text += `${day.padEnd(8)} | ${weight.padStart(5)} | ${kcal.padStart(4)} | ${protein.padStart(5)} | ${stepsStr}\n`;
    }
    text += '```\n';

    // ── Week averages ──
    const loggedDays = days.filter((d) => d.total_calories > 0);
    const avgKcal = average(days.map((d) => d.total_calories));
    const avgProtein = average(days.map((d) => d.total_protein));
    const avgSteps = average(days.map((d) => d.steps));
    const deficit = weeklyDeficit(days);
    const fatLoss = deficitToFatLoss(deficit);
    const proteinAdh = proteinAdherence(loggedDays);
    const stepsAdh = stepsAdherence(days);
    const excellentDays = countByStatus(days, 'excellent');

    // Weight change this week
    const weighedDays = days.filter((d) => d.weight != null);
    const weightChange =
      weighedDays.length >= 2
        ? Number(
            (
              (weighedDays[weighedDays.length - 1].weight ?? 0) - (weighedDays[0].weight ?? 0)
            ).toFixed(1),
          )
        : null;

    text += '\n*Средние за неделю:*\n';
    if (avgKcal !== null) text += `• Ккал: *${avgKcal}* (${loggedDays.length}/7 дней записано)\n`;
    if (avgProtein !== null) text += `• Белок: *${avgProtein}г* — норма ${proteinAdh}% дней\n`;
    if (avgSteps !== null)
      text += `• Шаги: *${avgSteps.toLocaleString('ru')}* — в норме ${stepsAdh}% дней\n`;
    if (excellentDays > 0) text += `• Статус ОТЛИЧНЫЙ: ${excellentDays}/7 дней ✨\n`;

    if (weightChange !== null) {
      const sign = weightChange > 0 ? '+' : '';
      const emoji = weightChange < 0 ? '📉' : weightChange > 0 ? '📈' : '➡️';
      text += `• Вес за неделю: ${emoji} *${sign}${weightChange} кг*\n`;
    }

    // ── Deficit & fat loss ──
    if (deficit > 0 && loggedDays.length >= 3) {
      text += '\n*Дефицит и прогресс:*\n';
      text += `• Накопленный дефицит: ~${Math.round(deficit)} ккал\n`;
      text += `• Теоретическая потеря жира: ~${fatLoss} кг\n`;
    }

    // ── Compare with previous week ──
    if (prevDays.length >= 3) {
      const prevAvgKcal = average(
        prevDays.filter((d) => d.total_calories > 0).map((d) => d.total_calories),
      );
      const prevAvgProtein = average(
        prevDays.filter((d) => d.total_protein > 0).map((d) => d.total_protein),
      );
      const prevAvgSteps = average(prevDays.map((d) => d.steps));

      text += '\n*Сравнение с прошлой неделей:*\n';
      if (avgKcal !== null && prevAvgKcal !== null) {
        const diff = avgKcal - prevAvgKcal;
        const sign = diff > 0 ? '+' : '';
        text += `• Ккал: ${sign}${diff} (${prevAvgKcal} → ${avgKcal})\n`;
      }
      if (avgProtein !== null && prevAvgProtein !== null) {
        const diff = avgProtein - prevAvgProtein;
        const sign = diff > 0 ? '+' : '';
        text += `• Белок: ${sign}${diff}г (${prevAvgProtein} → ${avgProtein}г)\n`;
      }
      if (avgSteps !== null && prevAvgSteps !== null) {
        const diff = avgSteps - prevAvgSteps;
        const sign = diff > 0 ? '+' : '';
        text += `• Шаги: ${sign}${Math.round(diff)} (${prevAvgSteps.toLocaleString('ru')} → ${avgSteps.toLocaleString('ru')})\n`;
      }
    }

    // ── Measurements reminder ──
    const lastM = lastMeasurement[0];
    if (lastM?.body_fat !== null && lastM) {
      const mDate = new Date(lastM.date).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
      });
      text += `\n📏 Последние замеры (${mDate}): талия ${lastM.waist} см · жир *${lastM.body_fat}%* · мышцы ${lastM.lean_mass} кг\n`;
    } else {
      text += '\n📏 *Замеры не внесены* — самое время сделать!\n';
    }

    // ── Adaptation warning ──
    if (adaptation.recommendation) {
      text += `\n${adaptation.recommendation}\n`;
    }

    // ── AI comment ──
    if (aiComment) {
      text += `\n🤖 _${aiComment}_`;
    }

    const keyboard = new InlineKeyboard()
      .text('📏 Внести замеры', 'action:log_measurements')
      .row()
      .text('🏠 Меню', 'action:main_menu');

    try {
      await bot.api.sendMessage(user.tg_id, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error(`[weekly cron] Failed for tg_id=${user.tg_id}:`, err);
    }
  }
}
