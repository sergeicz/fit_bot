-- Migration 002: recipes table
-- Run via: npx tsx scripts/migrate.ts

CREATE TABLE IF NOT EXISTS recipes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  ingredients     JSONB NOT NULL DEFAULT '[]',
  total_weight    INTEGER NOT NULL DEFAULT 0,
  kcal_per100     FLOAT NOT NULL DEFAULT 0,
  protein_per100  FLOAT NOT NULL DEFAULT 0,
  fat_per100      FLOAT NOT NULL DEFAULT 0,
  carbs_per100    FLOAT NOT NULL DEFAULT 0,
  use_count       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipes_user_id_idx ON recipes(user_id);
CREATE INDEX IF NOT EXISTS recipes_name_idx ON recipes USING gin(to_tsvector('russian', name));
