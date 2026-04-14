import 'dotenv/config';
import cron from 'node-cron';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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
import { sendWeeklyReport } from './cron/weekly';
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
 * Validates Telegram WebApp initData by checking HMAC-SHA256 signature.
 * Returns true only if the request came from a legitimate Telegram WebApp.
 */
function isValidTelegramInitData(initData: string): boolean {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken || !initData) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  params.delete('hash');
  const sortedParams = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = sortedParams.map(([key, value]) => `${key}=${value}`).join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return computedHash === hash;
}

// Block search engine indexing
app.use((_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

// Serve static files (CSS, JS, images — but NOT HTML)
app.use(express.static(webappDir));

// POST /api/verify — validate Telegram initData, return Supabase config
app.post('/api/verify', (req, res) => {
  const { initData } = req.body;

  if (!initData || !isValidTelegramInitData(initData)) {
    return res.status(403).send('🔒 Доступ ограничен.');
  }

  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// Serve index.html — lightweight shell that validates initData client-side
app.get('/', (_req, res) => {
  const htmlPath = path.join(webappDir, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('WebApp not built. Run `npm run build` first.');
  }

  let html = fs.readFileSync(htmlPath, 'utf-8');

  // Inject config so the client-side code can verify with the server
  html = html.replace(
    '__WEBAPP_GATEWAY__',
    process.env.WEBAPP_URL || 'https://fit.pushkarev.online',
  );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

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
