-- Migration 003: add height_cm to users for US Navy body fat formula
-- Run via: npx tsx scripts/migrate.ts

ALTER TABLE users ADD COLUMN IF NOT EXISTS height_cm SMALLINT;

-- Add body_fat column to measurements for storing calculated value
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS body_fat DECIMAL(5,2);
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS lean_mass DECIMAL(5,2);
