# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A personal Telegram bot (grammY + TypeScript) that acts as a data-driven personal trainer for a single user. Tracks weight, nutrition, and workouts with a cyclic calorie deficit plan targeting −20 kg over 24 weeks (96 kg → 76–78 kg, start June 1). Full specification: `fitness_bot_TZ.md`.

## Tech Stack

| Layer | Technology |
|---|---|
| Bot framework | grammY (Node.js + TypeScript) |
| Hosting | Railway (with native cron) |
| Database | Supabase (PostgreSQL + pgvector) |
| AI primary | Groq API (Llama 3.3 70B) |
| AI fallback | OpenRouter (DeepSeek) |
| Food DB | Open Food Facts (RU продукты) → Groq AI estimation (fallback) |
| Mini App | Telegram WebApp + Chart.js |

## Development Commands

```bash
npm run dev        # run bot in watch mode (tsx watch)
npm run build      # compile TypeScript to dist/
npm run start      # run compiled bot (dist/index.js)
npm run lint       # Biome check + auto-fix
npm run test       # Vitest (no tests yet — add in src/**/*.test.ts)
npx tsx scripts/migrate.ts  # run DB migrations against Supabase
```

## Code Style

Linter/formatter is **Biome** (`biome.json`), not ESLint. Rules:
- Single quotes, semicolons always, trailing commas
- 2-space indent, 100-char line width
- `noExplicitAny` is a warning, not an error

## Required Environment Variables

```
BOT_TOKEN=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
WEBAPP_URL=
```

## Implementation Status

**Stage 1 complete** (Railway + Supabase deployed):
- `/start`, `/menu` commands with main keyboard
- Weight logging (fasted/non-fasted, 7-day trend, diet break detection)
- `authMiddleware` — upserts user in DB, attaches `ctx.dbUser`
- `inputDetector` middleware — routes free-text by session step or pattern
- Morning cron: 08:00 / 09:30 / 11:00 weight reminders (node-cron, in-process)
- All DB tables created via `migrations/001_initial.sql`

**Stage 2 complete** (food logging + full cron schedule):
- `/food` command + `🍽️ Питание` inline button — 2-step manual entry: parse text → ask for kcal + protein
- `food.service.ts` — saves to `food_logs`, marks meal slot in `data_compliance`, recomputes `daily_summary`
- Day summary: status (ОТЛИЧНЫЙ / НОРМА / ПЕРЕБОР / НЕДОЕЛ / МАЛО БЕЛКА), shown after each entry and at 20:00
- Skip meal callbacks (`food:skip_meal1/2/3`) — mark slot as skipped, stop reminders
- Full meals cron in `src/cron/meals.ts`: 13:00 / 14:00 / 16:30 / 17:30 / 19:30 / 20:00
- Session in-memory (grammY built-in) — **no persistence across restarts**

**Stage 3 complete** (AI auto-analysis — no button):
- `ai.service.ts` — Groq (Llama 3.3 70B) primary → OpenRouter (DeepSeek) fallback
- `getAICommentary({ trigger, userId, ... })` — единственный публичный метод AI
- 4 триггера: `weight` (после веса), `food` (после приёма пищи), `eod` (20:00 итог), `question` (свободный текст)
- AI строит контекст из БД: сегодня / тренд 7–14 дней / последние 7 дней / общий прогресс
- Ответ (2–4 предложения) добавляется курсивом `🤖 _..._ ` к основному сообщению
- Если AI упал — молча скипается, основной response не ломается
- `input-detector.ts` fallback (шаг 4): любой текст не распознанный как вес/еда → AI отвечает как тренер

**Not yet implemented**: food APIs (Open Food Facts / AI fallback), workouts, adaptation, WebApp.

## Key Patterns

**`BotContext`** (`src/bot/types.ts`): all handlers receive `ctx.dbUser: DbUser` injected by `authMiddleware`. Never access the DB directly in commands — use services.

**Session state machine** (`ctx.session.step`): multi-step flows use the `step` field. Known steps: `awaiting_weight`, `awaiting_weight_not_fasted`, `awaiting_food_text`, `awaiting_food_nutrition`, `awaiting_food_grams`, `awaiting_food_confirm`, `awaiting_steps`. `inputDetector` runs first, checks `step`, routes accordingly. Reset `step` to `null` when flow completes.

**Cron**: uses `node-cron` in-process (not Railway native cron). Requires `TZ=Europe/Moscow` env var on Railway for Moscow-time expressions to work.

**Services pattern**: `src/services/*.service.ts` own all DB queries for their domain. Commands import services, never `supabase` directly.

**`day-type.ts` utilities**: `getMealSlot(date)` maps time to `'11:00'|'15:00'|'18:30'|null` (slots are 10:30–14:00 / 14:00–17:00 / 17:00–20:00). `isEatingWindow(date)` checks 11:00–19:00. `todayString()` uses machine local time — ensure `TZ=Europe/Moscow` on Railway. `getCycleWeightCorridor(cycleNumber)` returns expected weight range string per cycle.

## Current Project Structure

Built files (✅) vs planned (🔲):

```
src/
├── bot/
│   ├── index.ts              ✅ grammY entry point, all route registrations
│   ├── commands/
│   │   ├── start.ts          ✅ /start, /menu — shows day info + main keyboard
│   │   ├── weight.ts         ✅ weight logging flow (fasted/non-fasted)
│   │   └── food.ts           ✅ food logging (2-step manual: parse text → kcal+protein)
│   ├── keyboards/
│   │   └── main.ts           ✅ main keyboard + backToMenuKeyboard
│   └── middlewares/
│       ├── auth.ts           ✅ upserts user, attaches ctx.dbUser
│       └── input-detector.ts ✅ routes free text by step or auto-detect
├── services/
│   ├── user.service.ts       ✅ getOrCreate user
│   ├── weight.service.ts     ✅ saveWeight, getWeightHistory, getWeightTrend, buildWeightConfirmText
│   ├── food.service.ts       ✅ saveFood, recomputeDailySummary, getDailySummary, markMealSkipped, buildDaySummaryText
│   ├── ai.service.ts         ✅ getAICommentary (Groq→OpenRouter), buildContextText, 4 triggers
│   ├── cycle.service.ts      🔲 6-cycle logic and diet break detection
│   ├── adaptation.service.ts 🔲 detects weight plateau + 2+ adaptation signals
│   ├── ai.service.ts         🔲 Groq primary, OpenRouter fallback
│   ├── memory.service.ts     🔲 RAG via pgvector
│   └── food-api.service.ts   🔲 Open Food Facts + AI fallback search + caching
├── db/
│   ├── client.ts             ✅ Supabase client
│   └── types.ts              ✅ DB TypeScript types
├── cron/
│   ├── morning.ts            ✅ 08:00 (sendMorningReminder), 09:30 (sendMorningRepeat), 11:00 (sendMorningHard)
│   ├── meals.ts              ✅ 13:00 / 14:00 / 16:30 / 17:30 / 19:30 / 20:00
│   └── weekly.ts             🔲 Sunday 20:00 — measurements + weekly report
├── webapp/                   🔲 Telegram Mini App + Chart.js
└── utils/
    ├── parser.ts             ✅ parse "курица 200г рис 100г" → [{name, grams}]
    ├── day-type.ts           ✅ getDayType, getTargetCalories, getWeekNumber, getCycleInfo, getMealSlot, isEatingWindow, etc.
    └── calculator.ts         🔲 TDEE, deficit, weekly fat loss estimate
```

## Free-Text Input (Always-On)

The bot listens to **all incoming messages**, not just button presses. Any message that isn't a known command is run through the auto-detect middleware:

### Auto-detect logic (`middlewares/input-detector.ts`)
1. **Looks like a weight** — single number or `95.4` pattern → route to weight logging flow
2. **Looks like food** — contains product names / grams pattern → route to food parser
3. **Anything else** → route to AI (`ask.ts`)

This means a user can at any time just type `95.2` or `курица 200г рис 100г` without opening any menu, and the bot processes it correctly. Session state is used to handle multi-step flows (e.g. confirming parsed food) without losing context.

### Daily food counter
Every confirmed food entry triggers a recalculation of `daily_summary` for that day:
- `total_calories`, `total_protein`, `total_fat`, `total_carbs` are recomputed from all `food_logs` for that `user_id + date`
- Status (ОТЛИЧНЫЙ / НОРМА / ПЕРЕБОР / НЕДОЕЛ / КРИТИЧНО) is recalculated and shown after each entry
- `data_compliance` fields (`meal1_logged`, etc.) are updated based on the `meal_time` of the entry and current time

## Intermittent Fasting 16/8

Eating window: **11:00–19:00** (fasting 19:00–11:00 next day). This is a hard constraint built into all bot logic:

| Rule | Implementation |
|---|---|
| No food entries outside 11:00–19:00 | Bot warns if user tries to log food outside the window, still allows with confirmation |
| Morning weight = fasted weight | Logged before 11:00 → `is_fasted = true` automatically |
| 3 meals within window | 11:00 / 15:00 / 18:30 — reminders respect the window |
| Bot never suggests eating outside window | AI system prompt explicitly enforces this |
| Evening reminder at 19:30 | Last call before window closes — "окно закрывается через 30 мин" |

### IF-aware AI rules (added to system prompt)
- Never suggest eating after 19:00 or before 11:00
- If user is hungry during fasting hours → suggest water, electrolytes, distraction
- If user breaks the window → log it neutrally, don't lecture, note it in context

## Core Business Logic

### Calorie Cycle (weekly)
- Mon/Wed/Fri (workout): 1900 kcal — higher carbs, eating around training
- Tue/Thu/Sat (rest): 1600 kcal — low carbs, high protein
- Sun (light activity): 1700 kcal
- Weekly average: ~1743 kcal

### 6-Cycle System (24 weeks)
| Cycle | Weeks | Avg kcal |
|---|---|---|
| 1 | 1–4 | 1750–1850 |
| 2 | 5–8 | 1700–1750 |
| 3 | 9–12 | 1650–1700 |
| **Diet Break** | **13** | **2200–2400** |
| 4 | 14–17 | 1700–1800 |
| 5 | 18–21 | 1650–1750 |
| 6 | 22–24 | 1550–1700 |

Diet Break on week 13 is mandatory and planned — bot must always frame it as "part of the plan, not a failure". Weight gain of 1–2 kg during this week is water/glycogen, bot must explain this proactively.

### Adaptation Detection (`adaptation.service.ts`)
Signal when **2+ of these occur simultaneously**:
1. Weight stagnant 10–14 days despite calorie adherence
2. Steps not logged (NEAT reduction)
3. Training load decreased 2 weeks in a row
4. User reports constant hunger
5. User reports poor sleep

Response priority: check real accounting → add steps → diet break (5–7 days) → carb cycling → only then reduce calories by 100–150.

### Day Status Logic
| Status | Condition |
|---|---|
| ОТЛИЧНЫЙ | kcal ±100 of target, protein ≥ 155g, steps ≥ 6000 |
| НОРМА | kcal ±150 of target |
| ПЕРЕБОР | kcal > target + 200 |
| НЕДОЕЛ | kcal < target − 300 |
| КРИТИЧНО | protein < 140g (always warn, regardless of calories) |

### Deficit Calculation
```
actual_deficit = target_calories_for_day - actual_calories
weekly_deficit = sum(daily_deficits)
estimated_fat_loss = weekly_deficit / 7700  # kg of fat
```

## Database Schema

Tables: `users`, `weights`, `food_logs`, `frequent_foods`, `workouts`, `daily_summary`, `measurements`, `memory_vectors`, `data_compliance`

Key notes:
- `memory_vectors`: uses pgvector `VECTOR(1536)` with ivfflat cosine index. Enable `vector` extension in Supabase before migration.
- `frequent_foods`: products added 3+ times surface first in inline keyboard. Top 8 by `use_count` in last 30 days.
- `weights`: has `is_fasted` flag — non-fasted weigh-ins are stored but marked grey and excluded from 7-day moving average.
- `data_compliance`: tracks per-day discipline. `meal_skipped` (user confirmed skip) ≠ not logged. Bot stops reminding after explicit skip.
- Результаты Open Food Facts и AI кэшируются в `frequent_foods` для избежания повторных запросов.

## "Panic System" — Data Compliance (Section 16 of TZ)

The most complex feature. Bot aggressively ensures data is entered every day.

### Full Cron Schedule
| Time | Event | Trigger condition |
|---|---|---|
| 08:00 | Morning weight reminder | every day |
| 09:30 | Weight repeat | `weight_logged = false` |
| 11:00 | Hard weight reminder | `weight_logged = false` |
| 13:00 | Weight panic + meal 1 reminder | `weight_logged = false` OR `meal1_logged/skipped = false` |
| 14:00 | Meal 1 repeat | `meal1_logged = false AND meal1_skipped = false` |
| 16:30 | Meal 2 reminder | `meal2_logged = false AND meal2_skipped = false` |
| 17:30 | Meal 2 repeat | `meal2_logged = false AND meal2_skipped = false` |
| 19:30 | Meal 3 reminder | `meal3_logged = false AND meal3_skipped = false` |
| 20:00 | Meal 3 panic / day summary | always (condition changes text) |
| Sun 20:00 | Weekly report + discipline analysis | every Sunday |

### Escalation Tone Rules
1. Never blame — "bot doesn't know what you ate", not "you failed"
2. Always offer an easy out — "approximately" is better than nothing
3. Explain WHY each reminder matters (trend, deficit accuracy)
4. Escalate gradually: soft → firm → urgent
5. Don't repeat reminders after explicit "skipped" response

## Food Parser (`parser.ts`)

**Current (Stage 2) — manual nutrition entry:**
1. Regex extracts `(product, grams)` pairs — handles г/гр/грамм, шт/штук
2. Shows parsed items preview to user
3. Asks user to enter `kcal protein` manually (e.g. `580 75`)
4. Saves to DB with `source: 'manual'`

**Planned (Stage 3) — automatic via APIs:**
1. Fuzzy match against `frequent_foods` (≥80% → suggest immediately)
2. → Open Food Facts API (RU products)
3. → Groq AI estimation (marked "приблизительно")
4. Show result with: `[✅ Подтвердить]` / `[✏️ Изменить граммы]` / `[❌ Другой продукт]`

## AI Module (`ai.service.ts`)

Groq (primary) → OpenRouter (fallback):
```typescript
async function askAI(prompt: string, context: string): Promise<string> {
  try {
    return await groq.chat(prompt, context);
  } catch {
    return await openrouter.chat(prompt, context);
  }
}
```

Dynamic context injected into every request: current date/weekday, day type, target/actual kcal, protein, steps, last 7 days table, current cycle/week, weight trend.

System prompt is hardcoded with user profile. Key rules:
- Never drop protein below 160g
- Never recommend < 1500 kcal without explicit request + warning
- Diet break is part of the plan — always explain it as such
- Answer in Russian, friendly, no lecturing

## User Profile (Hardcoded)
- Start: 96 kg → Goal: ~76–78 kg
- Protein: 160–190 g daily (never reduce, 140g is red line for warnings)
- Eating window: 16/8 (11:00–19:00), 3 meals: 11:00 / 15:00 / 18:30
- Training: Mon/Wed/Fri full body
- Steps: min 6000–8000/day, entered manually (no watch API)
- NEAT: low

## MVP Development Order (7 Stages)
1. Skeleton: Railway + Supabase + /start + weight logging + 08:00 cron
2. Basic food: manual text input + food_logs + day summary + 20:00 cron
3. Food APIs: Open Food Facts + AI fallback + frequent foods inline keyboard
4. Smart summary: daily_summary + day statuses + weight trend
5. Workouts + cycle system + adaptation detector + weekly report cron
6. AI: Groq + dynamic DB context + OpenRouter fallback
7. WebApp (Chart.js) + pgvector RAG memory
