import 'dotenv/config';
import cron from 'node-cron';
import { bot } from './bot';
import { sendMorningReminder, sendMorningRepeat, sendMorningHard } from './cron/morning';

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

// ─── Start bot ────────────────────────────────────────────────────────────────
console.log('Starting fitness bot...');

bot.start({
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} is running`);
  },
});
