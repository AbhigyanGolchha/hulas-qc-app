/* eslint-disable no-console */
// Email delivery worker: retries queued notifications on an interval so mails
// still go out when SMTP was briefly down or the app was restarted mid-send.
//
//   npm run mail:worker                 (default: every 60s)
//   MAIL_WORKER_INTERVAL=30 npm run mail:worker
import { sendPendingMail, getMailConfig, isMailConfigured } from '../src/lib/mail';
import { prisma } from '../src/lib/db';

process.env.TZ = 'Asia/Kathmandu';
const intervalSec = Number(process.env.MAIL_WORKER_INTERVAL || 60);

async function tick() {
  try {
    const { sent, failed } = await sendPendingMail();
    if (sent || failed) console.log(`[${new Date().toISOString()}] mail sent=${sent} failed=${failed}`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] mail worker error:`, e);
  }
}

async function main() {
  const cfg = await getMailConfig();
  console.log(`Mail worker started — ${isMailConfigured(cfg) ? `SMTP ${cfg.host}:${cfg.port}` : 'email NOT configured (idle until Admin → Notifications is set up)'}, interval=${intervalSec}s. Ctrl-C to stop.`);
  await tick();
  setInterval(tick, intervalSec * 1000);
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

void main();
