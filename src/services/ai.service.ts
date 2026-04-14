import { supabase } from '../db/client';
import type { DbDailySummary } from '../db/types';
import {
  formatDateRu,
  getCycleInfo,
  getCycleWeightCorridor,
  getDayType,
  getDayTypeLabel,
  getTargetCalories,
  getWeekNumber,
  todayString,
} from '../utils/day-type';
import { statusLabel } from './food.service';
import { findRelevantChunks } from './knowledge.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AITrigger = 'weight' | 'food' | 'eod' | 'question';

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты персональный тренер-нутрициолог в Telegram-боте для одного пользователя.

ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:
- Цель: снизить вес с 96 кг до 76–78 кг за 24 недели (старт 1 июня)
- Протокол питания: 16/8 (окно 11:00–19:00), 3 приёма: 11:00 / 15:00 / 18:30
- Тренировки: Пн/Ср/Пт — фулл-боди
- Цикловая система (6 циклов × 4 нед): цель ккал снижается каждый цикл
  Цикл 1 (нед.1–4): 1850/1650/1750 | Цикл 2 (нед.5–8): 1800/1600/1700
  Цикл 3 (нед.9–12): 1750/1550/1650 | Диет-брейк (нед.13): 2300 все дни
  Цикл 4 (нед.14–17): 1800/1600/1700 | Цикл 5 (нед.18–21): 1750/1600/1700
  Цикл 6 (нед.22–24): 1700/1550/1600 — формат: тренировка/отдых/воскресенье
- Белок: 160–190 г/день (минимум 140 г — красная линия)
- Белок: 160–190 г/день (минимум 140 г — красная линия)
- Шаги: 6000–8000/день

ЖЁСТКИЕ ПРАВИЛА:
1. Никогда не рекомендуй есть после 19:00 или до 11:00
2. Никогда не рекомендуй меньше 1500 ккал без явной просьбы + предупреждения
3. Белок нельзя снижать ниже 160 г
4. Диет-брейк (неделя 13) — часть плана, не срыв. Всегда объясняй это
5. Прирост 1–2 кг на диет-брейке — вода и гликоген, не жир

СТИЛЬ ОБЩЕНИЯ:
- Отвечай только на русском языке
- Коротко и по делу: 2–4 предложения (если не задан прямой вопрос)
- Ссылайся на реальные цифры из контекста, не на абстракции
- Никогда не читай лекции и не обвиняй
- Тон дружелюбный, как опытный тренер который видит твои данные
- После веса — комментируй прогресс с опорой на тренд и цикл
- После еды — комментируй текущую дневную картину, дай 1 конкретный совет
- В конце дня — итог + 1 главная задача на завтра
- На вопросы — отвечай развёрнуто с опорой на контекст`;

// ─── Context builder ──────────────────────────────────────────────────────────

async function buildContextText(
  userId: string,
  startDate: Date,
  goalWeight: number,
): Promise<string> {
  const today = todayString();
  const now = new Date();
  const weekNumber = getWeekNumber(startDate, now);
  const { cycleNumber, isDietBreak } = getCycleInfo(weekNumber);
  const dayType = getDayType(now);
  const targetCalories = getTargetCalories(dayType, weekNumber);

  // Parallel DB queries
  const [todaySummaryRes, weightHistoryRes, last7SummariesRes] = await Promise.all([
    supabase.from('daily_summary').select('*').eq('user_id', userId).eq('date', today).single(),

    supabase
      .from('weights')
      .select('date, weight, is_fasted')
      .eq('user_id', userId)
      .eq('is_fasted', true)
      .order('date', { ascending: false })
      .limit(14),

    supabase
      .from('daily_summary')
      .select('date, total_calories, total_protein, status, weight, target_calories, steps')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(8),
  ]);

  const todaySummary = todaySummaryRes.data as DbDailySummary | null;
  const weightHistory = weightHistoryRes.data ?? [];
  const last7 = (last7SummariesRes.data ?? []).filter((d) => d.date !== today).slice(0, 7);

  // ── Today ──
  let ctx = '=== КОНТЕКСТ ===\n';
  ctx += `Дата: ${formatDateRu(now)} | Тип дня: ${getDayTypeLabel(dayType)}\n`;

  if (isDietBreak) {
    ctx += `⚠️ ДИЕТ-БРЕЙК (неделя ${weekNumber}) — цель 2200–2400 ккал\n`;
  } else {
    ctx += `Неделя ${weekNumber}, Цикл ${cycleNumber} | Цель: ${targetCalories} ккал\n`;
  }

  ctx += '\nСЕГОДНЯ:\n';
  if (todaySummary) {
    const kcal = Math.round(todaySummary.total_calories);
    const protein = Math.round(todaySummary.total_protein);
    if (todaySummary.weight) ctx += `• Вес: ${todaySummary.weight} кг\n`;
    if (kcal > 0) {
      ctx += `• Ккал: ${kcal} / ${targetCalories} (${Math.round((kcal / targetCalories) * 100)}%)\n`;
      ctx += `• Белок: ${protein}г / 160г\n`;
      if (todaySummary.status) ctx += `• Статус: ${statusLabel(todaySummary.status)}\n`;
    } else {
      ctx += '• Питание: не записано\n';
    }
    if (todaySummary.steps != null) {
      const stepsIcon = todaySummary.steps >= 6000 ? '✅' : todaySummary.steps < 4000 ? '🚨' : '⚠️';
      ctx += `• Шаги: ${stepsIcon} ${todaySummary.steps.toLocaleString('ru')} / 6000–8000\n`;
    } else if (todaySummary.steps_unavailable) {
      ctx += '• Шаги: часы не носил\n';
    } else {
      ctx += '• Шаги: не записаны\n';
    }
  } else {
    ctx += '• Данных за сегодня нет\n';
  }

  // ── Weight trend ──
  if (weightHistory.length > 0) {
    ctx += '\nТРЕНД ВЕСА (натощак):\n';
    const recent = weightHistory.slice(0, 7);
    ctx += `${recent.map((w) => `${w.date}: ${w.weight} кг`).join(' | ')}\n`;

    if (weightHistory.length >= 2) {
      const latest = weightHistory[0].weight;
      const oldest7 = weightHistory[Math.min(6, weightHistory.length - 1)].weight;
      const trend7 = Number((latest - oldest7).toFixed(1));
      const sign = trend7 > 0 ? '+' : '';
      ctx += `7-дневный тренд: ${sign}${trend7} кг\n`;
    }

    if (weightHistory.length >= 7) {
      const oldest14 = weightHistory[Math.min(13, weightHistory.length - 1)].weight;
      const latest = weightHistory[0].weight;
      const trend14 = Number((latest - oldest14).toFixed(1));
      const sign14 = trend14 > 0 ? '+' : '';
      ctx += `14-дневный тренд: ${sign14}${trend14} кг\n`;
    }
  }

  // ── Last 7 days ──
  if (last7.length > 0) {
    ctx += '\nПОСЛЕДНИЕ 7 ДНЕЙ:\n';
    ctx += 'Дата       | Ккал | Белок | Шаги  | Статус\n';
    for (const d of last7) {
      const kcal = Math.round(d.total_calories ?? 0);
      const protein = Math.round(d.total_protein ?? 0);
      const stepsStr = d.steps != null ? d.steps.toLocaleString('ru').padStart(5) : '  н/д';
      const status = d.status ? statusLabel(d.status) : '—';
      ctx += `${d.date} | ${kcal.toString().padStart(4)} | ${protein}г | ${stepsStr} | ${status}\n`;
    }

    // Weekly averages (last 7 days with food data)
    const daysWithFood = last7.filter((d) => (d.total_calories ?? 0) > 0);
    if (daysWithFood.length > 0) {
      const avgKcal = Math.round(
        daysWithFood.reduce((s, d) => s + (d.total_calories ?? 0), 0) / daysWithFood.length,
      );
      const avgProtein = Math.round(
        daysWithFood.reduce((s, d) => s + (d.total_protein ?? 0), 0) / daysWithFood.length,
      );
      ctx += `Средние за ${daysWithFood.length} дн.: ${avgKcal} ккал / ${avgProtein}г белка\n`;
    }
  }

  // ── Overall progress ──
  const startWeight = 96; // hardcoded from profile
  const currentWeight = weightHistory[0]?.weight ?? startWeight;
  const totalLost = Number((startWeight - currentWeight).toFixed(1));
  const weeksElapsed = weekNumber;
  const remaining = Number((currentWeight - goalWeight).toFixed(1));
  const pace = weeksElapsed > 0 ? Number((totalLost / weeksElapsed).toFixed(2)) : 0;
  const expectedWeeks = pace > 0 ? Math.round(remaining / pace) : null;
  const weightCorridor = getCycleWeightCorridor(cycleNumber);

  ctx += '\nОБЩАЯ КАРТИНА:\n';
  ctx += `• Старт: ${startWeight} кг → Сейчас: ${currentWeight} кг → Цель: ${goalWeight} кг\n`;
  ctx += `• Прошло: ${weeksElapsed} нед. | Потеряно: ${totalLost > 0 ? totalLost : 0} кг\n`;
  ctx += `• Темп: ${pace > 0 ? `${pace} кг/нед` : 'данных пока мало'}\n`;
  if (expectedWeeks !== null && remaining > 0) {
    ctx += `• До цели: ещё ~${remaining} кг (~${expectedWeeks} нед. при текущем темпе)\n`;
  }
  ctx += `• Ожидаемый коридор цикла ${cycleNumber}: ${weightCorridor}\n`;

  return ctx;
}

// ─── API callers ──────────────────────────────────────────────────────────────

async function callGroq(
  systemPrompt: string,
  contextText: string,
  userMessage: string,
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${contextText}\n\n${userMessage}` },
      ],
      temperature: 0.7,
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Groq error: ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content.trim();
}

async function callOpenRouter(
  systemPrompt: string,
  contextText: string,
  userMessage: string,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/fitness-bot',
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${contextText}\n\n${userMessage}` },
      ],
      temperature: 0.7,
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`OpenRouter error: ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content.trim();
}

async function callAI(contextText: string, userMessage: string): Promise<string> {
  try {
    return await callGroq(SYSTEM_PROMPT, contextText, userMessage);
  } catch (err) {
    console.warn('[AI] Groq failed, trying OpenRouter:', err);
    return await callOpenRouter(SYSTEM_PROMPT, contextText, userMessage);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns AI commentary for a given trigger event.
 * Never throws — returns null on failure so callers can skip silently.
 */
export async function getAICommentary(params: {
  trigger: AITrigger;
  userId: string;
  startDate: Date;
  goalWeight: number;
  /** Extra detail about the event (e.g. "записал вес 94.5 кг") */
  eventDetail?: string;
}): Promise<string | null> {
  const { trigger, userId, startDate, goalWeight, eventDetail } = params;

  try {
    const contextText = await buildContextText(userId, startDate, goalWeight);

    let userMessage: string;
    switch (trigger) {
      case 'weight':
        userMessage = `Пользователь только что ${eventDetail ?? 'записал вес'}. Дай короткий (2–3 предложения) комментарий к прогрессу, опираясь на тренд и цель. Без списков — просто текст.`;
        break;

      case 'food':
        userMessage = `Пользователь только что ${eventDetail ?? 'записал приём пищи'}. Прокомментируй текущую дневную картину (ккал и белок vs цель). Если нужен конкретный совет — дай 1 действие. Без списков, 2–3 предложения.`;
        break;

      case 'eod':
        userMessage = `Конец дня. ${eventDetail ?? ''} Дай итоговый анализ дня: что хорошо, что подтянуть. Закончи одним конкретным советом на завтра. 3–4 предложения.`;
        break;

      case 'question':
        userMessage =
          eventDetail ?? 'Ответь на вопрос пользователя, опираясь на его данные из контекста.';
        break;
    }

    // Find relevant knowledge base chunks for this query
    const knowledgeQuery = `${trigger} ${eventDetail ?? ''} ${userMessage}`;
    const knowledgeContext = findRelevantChunks(knowledgeQuery, 3);

    const fullContext = knowledgeContext ? `${contextText}\n\n${knowledgeContext}` : contextText;

    const response = await callAI(fullContext, userMessage);
    return response || null;
  } catch (err) {
    console.error('[AI] getAICommentary failed:', err);
    return null;
  }
}
