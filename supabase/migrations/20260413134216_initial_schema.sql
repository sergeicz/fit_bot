-- Enable pgvector extension for RAG memory
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_id         BIGINT UNIQUE NOT NULL,
  username      TEXT,
  start_weight  DECIMAL(5,2) DEFAULT 96.0,
  goal_weight   DECIMAL(5,2) DEFAULT 77.0,
  start_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  current_cycle INT DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Weights ─────────────────────────────────────────────────────────────────
-- is_fasted: true = taken before eating (used for trend); false = taken after eating (stored but excluded from moving average)
CREATE TABLE weights (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  date      DATE NOT NULL,
  weight    DECIMAL(5,2) NOT NULL,
  is_fasted BOOLEAN DEFAULT TRUE,
  logged_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- ─── Food logs ───────────────────────────────────────────────────────────────
-- meal_time: '11:00' | '15:00' | '18:30' — maps to the 3 meals in the eating window
-- source: 'frequent' | 'open_food_facts' | 'usda' | 'ai_estimate' | 'manual'
CREATE TABLE food_logs (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  date      DATE NOT NULL,
  meal_time TEXT,
  food_name TEXT NOT NULL,
  grams     DECIMAL(7,2),
  calories  DECIMAL(7,2) NOT NULL DEFAULT 0,
  protein   DECIMAL(7,2) NOT NULL DEFAULT 0,
  fat       DECIMAL(7,2) NOT NULL DEFAULT 0,
  carbs     DECIMAL(7,2) NOT NULL DEFAULT 0,
  source    TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Frequent foods ──────────────────────────────────────────────────────────
-- use_count >= 3 → appears in inline keyboard "⭐ Частые продукты"
-- last_grams: default grams offered as first button on next use
CREATE TABLE frequent_foods (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  food_name  TEXT NOT NULL,
  last_grams DECIMAL(7,2),
  calories   DECIMAL(7,2),
  protein    DECIMAL(7,2),
  fat        DECIMAL(7,2),
  carbs      DECIMAL(7,2),
  use_count  INT DEFAULT 1,
  last_used  DATE,
  UNIQUE(user_id, food_name)
);

-- ─── Workouts ────────────────────────────────────────────────────────────────
-- exercises JSONB: [{name, sets, reps, weight_kg}]
CREATE TABLE workouts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  type         TEXT DEFAULT 'full_body',
  exercises    JSONB,
  notes        TEXT,
  duration_min INT,
  logged_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- ─── Daily summary ───────────────────────────────────────────────────────────
-- Recalculated on every food_log insert/delete and on weight/steps update.
-- status: 'excellent' | 'ok' | 'over' | 'under' | 'critical_protein'
CREATE TABLE daily_summary (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  day_type        TEXT,
  target_calories INT,
  total_calories  DECIMAL(7,2) DEFAULT 0,
  total_protein   DECIMAL(7,2) DEFAULT 0,
  total_fat       DECIMAL(7,2) DEFAULT 0,
  total_carbs     DECIMAL(7,2) DEFAULT 0,
  steps           INT,
  steps_unavailable BOOLEAN DEFAULT FALSE,
  weight          DECIMAL(5,2),
  status          TEXT,
  UNIQUE(user_id, date)
);

-- ─── Body measurements ───────────────────────────────────────────────────────
CREATE TABLE measurements (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  waist   DECIMAL(5,2),
  neck    DECIMAL(5,2),
  chest   DECIMAL(5,2),
  hips    DECIMAL(5,2),
  UNIQUE(user_id, date)
);

-- ─── Vector memory (RAG) ─────────────────────────────────────────────────────
-- type: 'food_preference' | 'progress_note' | 'ai_insight'
CREATE TABLE memory_vectors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  embedding  VECTOR(1536),
  type       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON memory_vectors USING ivfflat (embedding vector_cosine_ops);

-- ─── Data compliance ─────────────────────────────────────────────────────────
-- Tracks per-day discipline for the "panic system".
-- _skipped fields = user explicitly confirmed they skipped (no more reminders for that meal).
-- _logged fields = data was actually entered.
-- reminders_sent: total reminders sent today (for escalation logic).
CREATE TABLE data_compliance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  weight_logged   BOOLEAN DEFAULT FALSE,
  weight_fasted   BOOLEAN DEFAULT TRUE,
  meal1_logged    BOOLEAN DEFAULT FALSE,
  meal1_skipped   BOOLEAN DEFAULT FALSE,
  meal2_logged    BOOLEAN DEFAULT FALSE,
  meal2_skipped   BOOLEAN DEFAULT FALSE,
  meal3_logged    BOOLEAN DEFAULT FALSE,
  meal3_skipped   BOOLEAN DEFAULT FALSE,
  reminders_sent  INT DEFAULT 0,
  UNIQUE(user_id, date)
);
