# Fitness Bot — Project Context

## Project Overview

A personal Telegram bot (grammY + TypeScript) that acts as a data-driven personal trainer for a single user. It tracks weight, nutrition, and workouts with a cyclic calorie deficit plan targeting **−20 kg over 24 weeks** (96 kg → 76–78 kg, start June 1). Full technical specification: `fitness_bot_TZ.md`.

### Key Features
- **Weight logging** with fasted/non-fasted tracking, 7-day trends, diet break detection
- **Food logging** with text parsing, manual/API-based nutrition lookup, daily summary
- **AI coaching** via Groq (Llama 3.3 70B) with OpenRouter fallback — auto-analyzes weight/food entries and answers free-text questions
- **Intermittent fasting 16/8** (eating window 11:00–19:00) enforced across all bot logic
- **Cyclic calorie system**: Mon/Wed/Fri 1900 kcal (workout), Tue/Thu/Sat 1600 kcal (rest), Sun 1700 kcal
- **6-cycle adaptation system** (24 weeks) with mandatory diet break on week 13
- **Aggressive cron reminders** (08:00–23:00) ensuring daily data compliance
- **Knowledge base**: PDF/text files in `knowledge/` loaded at startup for recipe and nutrition reference

## Tech Stack

| Layer | Technology |
|---|---|
| Bot framework | grammY (Node.js + TypeScript) |
| Hosting | Railway (nixpacks builder) |
| Database | Supabase (PostgreSQL + pgvector) |
| AI primary | Groq API (Llama 3.3 70B) |
| AI fallback | OpenRouter (DeepSeek) |
| Food DB | Open Food Facts (RU продукты) → Groq AI estimation (fallback) |
| Linter/Formatter | Biome |
| Test runner | Vitest |

## Directory Structure

```
fitness_bot/
├── src/
│   ├── bot/
│   │   ├── index.ts              # grammY entry point + route registrations
│   │   ├── types.ts              # BotContext, SessionData types
│   │   ├── commands/             # Command handlers (start, weight, food, etc.)
│   │   ├── keyboards/            # Inline & reply keyboard builders
│   │   └── middlewares/          # auth.ts (user upsert), input-detector.ts (free-text routing)
│   ├── services/
│   │   ├── user.service.ts       # getOrCreate user
│   │   ├── weight.service.ts     # saveWeight, getWeightHistory, getWeightTrend
│   │   ├── food.service.ts       # saveFood, recomputeDailySummary, buildDaySummaryText
│   │   ├── ai.service.ts         # getAICommentary (Groq→OpenRouter), 4 triggers
│   │   ├── adaptation.service.ts # detects weight plateau + adaptation signals
│   │   ├── food-api.service.ts   # Open Food Facts + AI fallback search + caching
│   │   ├── knowledge.service.ts  # loads knowledge/ PDFs into context
│   │   └── recipe.service.ts     # recipe CRUD from knowledge base
│   ├── cron/
│   │   ├── morning.ts            # 08:00 / 09:30 / 11:00 weight reminders
│   │   ├── meals.ts              # 13:00 / 14:00 / 16:30 / 17:30 / 19:30 / 20:00 / 23:00
│   │   └── weekly.ts             # Sunday 20:00 weekly report
│   ├── db/
│   │   ├── client.ts             # Supabase client
│   │   └── types.ts              # TypeScript types for DB tables
│   ├── utils/
│   │   ├── parser.ts             # parse "курица 200г рис 100г" → [{name, grams}]
│   │   ├── day-type.ts           # getDayType, getTargetCalories, getMealSlot, isEatingWindow
│   │   └── calculator.ts         # TDEE, deficit, weekly fat loss estimate
│   └── index.ts                  # Bot startup + all cron schedules
├── migrations/
│   ├── 001_initial.sql           # Core DB tables (users, weights, food_logs, etc.)
│   └── 002_recipes.sql           # Recipes table for knowledge base
├── knowledge/                    # PDF/TXT reference files (recipes, guides, plans)
├── scripts/                      # Utility scripts (e.g., migrate.ts)
└── supabase/                     # Supabase local config
```

## Building and Running

### Prerequisites
- Node.js >= 20
- Supabase project (with `vector` extension enabled for pgvector)
- Telegram Bot Token
- Groq API key, OpenRouter API key

### Setup

```bash
npm install
cp .env.example .env  # then fill in all required variables
```

### Development Commands

```bash
npm run dev        # Run bot in watch mode (tsx watch src/index.ts)
npm run build      # Compile TypeScript to dist/
npm run start      # Run compiled bot (node dist/index.js)
npm run lint       # Biome check + auto-fix
npm run test       # Vitest run (add tests as src/**/*.test.ts)
npx tsx scripts/migrate.ts  # Run DB migrations against Supabase
```

### Deployment (Railway)

- `railway.toml` uses nixpacks builder
- Build: `npm run build`
- Start: `npm start`
- Set `TZ=Europe/Moscow` as environment variable on Railway so cron expressions use Moscow time
- All cron jobs run in-process via `node-cron` (not Railway native cron)

### Required Environment Variables

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram bot token |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `GROQ_API_KEY` | Groq API (AI primary) |
| `OPENROUTER_API_KEY` | OpenRouter API (AI fallback) |
| `WEBAPP_URL` | Telegram Mini App URL |

## Key Patterns

### BotContext
All handlers receive `ctx: BotContext` which includes `ctx.dbUser: DbUser` injected by `authMiddleware`. **Never access the DB directly in commands** — use services from `src/services/`.

### Session State Machine
Multi-step flows use `ctx.session.step`. Known steps:
- `awaiting_weight` / `awaiting_weight_not_fasted` — weight logging
- `awaiting_food_text` / `awaiting_food_nutrition` / `awaiting_food_grams` / `awaiting_food_confirm` — food entry
- `awaiting_steps` — manual step count
- `awaiting_recipe_name` / `awaiting_recipe_ingredients` / `awaiting_recipe_portion` — recipe creation

Reset `step` to `null` when flow completes. **Session is in-memory only** (no persistence across restarts).

### Free-Text Input (Always-On)
The bot listens to **all incoming messages**. The `inputDetector` middleware runs first:
1. Looks like a weight → route to weight flow
2. Looks like food → route to food parser
3. Anything else → route to AI as a coaching question

### Services Pattern
`src/services/*.service.ts` own all DB queries for their domain. Commands import services, never `supabase` directly.

### Cron Schedule (all Moscow time)

| Time | Event | Condition |
|---|---|---|
| 08:00 | Morning weight reminder | Every day |
| 09:30 | Weight repeat | `weight_logged = false` |
| 11:00 | Hard weight reminder | `weight_logged = false` |
| 13:00 | Weight panic + meal 1 reminder | `weight_logged = false` OR `meal1` not done |
| 14:00 | Meal 1 repeat | `meal1` not logged/skipped |
| 16:30 | Meal 2 reminder | `meal2` not logged/skipped |
| 17:30 | Meal 2 repeat | `meal2` not logged/skipped |
| 19:30 | Meal 3 reminder | Window closes in 30 min |
| 20:00 | Day summary + meal 3 panic | Always |
| 23:00 | Steps reminder | `steps` not logged |
| Sun 20:00 | Weekly report | Every Sunday |

## Code Style (Biome)

- Single quotes, semicolons always, trailing commas
- 2-space indent, 100-char line width
- `noExplicitAny` is a warning, not an error
- Organize imports enabled (auto-sorted)

## Database Schema

Core tables: `users`, `weights`, `food_logs`, `frequent_foods`, `workouts`, `daily_summary`, `measurements`, `memory_vectors`, `data_compliance`, `recipes`

- `memory_vectors`: uses pgvector `VECTOR(1536)` with ivfflat cosine index
- `frequent_foods`: products added 3+ times surface first in inline keyboard (top 8 by `use_count` in last 30 days)
- `data_compliance`: tracks per-day discipline; `meal_skipped` ≠ not logged; bot stops reminding after explicit skip
- Migration files in `migrations/`; run via `npx tsx scripts/migrate.ts`

## Implementation Status

| Stage | Status | Description |
|---|---|---|
| 1 | ✅ Complete | Railway + Supabase deployed, /start + weight logging, morning cron |
| 2 | ✅ Complete | Food logging (manual), day summary, full meals cron |
| 3 | ✅ Complete | AI auto-analysis (Groq→OpenRouter), 4 triggers |
| Food APIs | 🔲 Planned | Open Food Facts + AI fallback integration |
| Workouts | 🔲 Planned | Workout logging + analytics |
| Cycle system | 🔲 Planned | 6-cycle logic + diet break detection |
| WebApp | 🔲 Planned | Telegram Mini App + Chart.js graphs |
| RAG Memory | 🔲 Planned | pgvector-based AI memory |

## Important Business Rules

1. **Protein red line**: Always warn if protein < 140g, never recommend below 160g
2. **Diet break is part of the plan**: Week 13 is mandatory recovery — frame positively, not as failure
3. **Never compensate days**: If user ate less yesterday, don't suggest eating more today
4. **Plateo ≠ failure**: Check accounting reality first, then steps, then recommend diet break
5. **Never recommend < 1500 kcal** without explicit request + risk warning
6. **Steps are mandatory minimum**: 6000 steps always in context; without them "adaptation eats the deficit"
7. **Tone**: Friendly, specific, no lecturing. Never says "you broke the diet"
