import 'dotenv/config';
import cron from 'node-cron';
import { bot } from './bot';
import {
  sendDaySummary20,
  sendMeal1Repeat14,
  sendMeal2Reminder1630,
  sendMeal2Repeat1730,
  sendMeal3Reminder1930,
  sendMealAndWeightPanic13,
} from './cron/meals';
import { sendMorningHard, sendMorningReminder, sendMorningRepeat } from './cron/morning';

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

// ─── Start bot ────────────────────────────────────────────────────────────────
console.log('Starting fitness bot...');

bot.start({
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} is running`);
  },
});
