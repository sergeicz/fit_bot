import 'dotenv/config';
import cron from 'node-cron';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { bot } from './bot';
import {
  sendDaySummary20,
  sendMeal1Repeat14,
  sendMeal2Reminder1630,
  sendMeal2Repeat1730,
  sendMeal3Reminder1930,
  sendMealAndWeightPanic13,
  sendStepsReminder23,
} from './cron/meals';
import { sendMorningHard, sendMorningReminder, sendMorningRepeat } from './cron/morning';
import { sendMeasurementsReminder, sendWeeklyReport } from './cron/weekly';
import { loadKnowledgeBase } from './services/knowledge.service';

// ─── Cron jobs ────────────────────────────────────────────────────────────────
// All times are in the server's local timezone.
// Set TZ=Europe/Moscow on Railway so cron expressions match Moscow time.

// 08:00 — first morning reminder (weigh in)
cron.schedule('0 8 * * *', () => {
  sendMorningReminder().catch(console.error);
});

// 09:30 — soft repeat if weight not logged
cron.schedule('30 9 * * *', () => {
  sendMorningRepeat().catch(console.error);
});

// 11:00 — hard reminder if weight still not logged
cron.schedule('0 11 * * *', () => {
  sendMorningHard().catch(console.error);
});

// 13:00 — weight panic + meal 1 reminder
cron.schedule('0 13 * * *', () => {
  sendMealAndWeightPanic13().catch(console.error);
});

// 14:00 — meal 1 repeat if still not logged
cron.schedule('0 14 * * *', () => {
  sendMeal1Repeat14().catch(console.error);
});

// 16:30 — meal 2 reminder
cron.schedule('30 16 * * *', () => {
  sendMeal2Reminder1630().catch(console.error);
});

// 17:30 — meal 2 repeat
cron.schedule('30 17 * * *', () => {
  sendMeal2Repeat1730().catch(console.error);
});

// 19:30 — meal 3 reminder (window closes in 30 min)
cron.schedule('30 19 * * *', () => {
  sendMeal3Reminder1930().catch(console.error);
});

// 20:00 — day summary + meal 3 panic
cron.schedule('0 20 * * *', () => {
  sendDaySummary20().catch(console.error);
});

// 23:00 — steps reminder if not logged
cron.schedule('0 23 * * *', () => {
  sendStepsReminder23().catch(console.error);
});

// Sat 09:00 — measurements reminder (if not done this week)
cron.schedule('0 9 * * 6', () => {
  sendMeasurementsReminder().catch(console.error);
});

// Sun 20:00 — weekly report
cron.schedule('0 20 * * 0', () => {
  sendWeeklyReport().catch(console.error);
});

// ─── Load knowledge base ──────────────────────────────────────────────────────
loadKnowledgeBase().catch(console.error);

// ─── Express server for WebApp ─────────────────────────────────────────────────
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

const webappDir = path.join(__dirname, 'webapp');

/**
 * Parses Telegram WebApp initData to extract user info.
 */
function parseInitDataUser(initData: string): { id: number; username?: string } | null {
  try {
    const params = new URLSearchParams(initData);
    const userJson = params.get('user');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch {
    return null;
  }
}

/**
 * Checks if the given tg_id is allowed to access the WebApp.
 * Allowed IDs are listed in WEBAPP_ALLOWED_TG_IDS env var (comma-separated).
 */
function isAllowedUser(tgId: number): boolean {
  const allowedStr = process.env.WEBAPP_ALLOWED_TG_IDS?.trim();
  if (!allowedStr) return false;
  const allowed = allowedStr.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  return allowed.includes(tgId);
}

// Block search engine indexing
app.use((_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

// Serve static assets (CSS, JS, images) only under /app/* — no directory listing, no index.html
app.use('/app', express.static(webappDir, { index: false }));

// All other paths → 404 (browser access blocked)
app.get('/', (_req, res) => res.status(404).send('Not Found'));

// POST /api/verify — validate Telegram initData, return Supabase config
app.post('/api/verify', async (req, res) => {
  const { initData } = req.body;

  if (!initData) {
    return res.status(403).send('Forbidden');
  }

  const user = parseInitDataUser(initData);
  if (!user?.id) {
    return res.status(403).send('Forbidden');
  }

  if (!isAllowedUser(user.id)) {
    console.log(`[WebApp] Denied: tg_id=${user.id} not in allowed list`);
    return res.status(403).send('Forbidden');
  }

  console.log(`[WebApp] Allowed: tg_id=${user.id} (${user.username || 'no username'})`);
  return res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// GET /app — serve Mini App HTML with gateway URL substituted
app.get('/app', (_req, res) => {
  const htmlPath = path.join(webappDir, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('Not Found');
  }

  let html = fs.readFileSync(htmlPath, 'utf-8');
  const gateway = (process.env.WEBAPP_URL || 'https://fit.pushkarev.online').replace(/\/$/, '');
  html = html.replace('__WEBAPP_GATEWAY__', gateway);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Everything else → 404
app.use((_req, res) => res.status(404).send('Not Found'));

app.listen(PORT, () => {
  console.log(`WebApp serving on http://localhost:${PORT}`);
});

// ─── Start bot ────────────────────────────────────────────────────────────────
console.log('Starting fitness bot...');

async function startBot(attempt = 1): Promise<void> {
  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: (botInfo) => {
        console.log(`Bot @${botInfo.username} is running`);
      },
    });
  } catch (err: unknown) {
    // 409 = another instance still running (happens during Railway deploys)
    const is409 = err instanceof Error && err.message.includes('409');
    if (is409 && attempt <= 5) {
      const delay = attempt * 3000;
      console.warn(`[Bot] 409 conflict, retrying in ${delay / 1000}s (attempt ${attempt}/5)...`);
      await new Promise((r) => setTimeout(r, delay));
      return startBot(attempt + 1);
    }
    throw err;
  }
}

startBot();
