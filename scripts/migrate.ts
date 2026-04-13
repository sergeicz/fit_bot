import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const client = new Client({
  host: 'db.rbhtywicrfdrraamculi.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  console.log('Connecting to database...');
  await client.connect();
  console.log('Connected.');

  const sql = readFileSync(join(__dirname, '../migrations/001_initial.sql'), 'utf8');

  console.log('Running migration 001_initial.sql...');
  await client.query(sql);
  console.log('✅ Migration completed successfully.');

  await client.end();
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
