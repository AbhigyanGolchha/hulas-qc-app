/* eslint-disable no-console */
// SAP delivery worker: polls the integration outbox and delivers pending
// payloads on an interval. Run alongside the app in production:
//
//   npm run sap:worker            (default: every 60s)
//   SAP_WORKER_INTERVAL=300 npm run sap:worker
//
// Uses the same connector code as the app, straight against the database —
// no HTTP hop, no auth needed. Safe to run 24/7; rows failing 5 times park
// as FAILED for a human to look at in Admin → SAP connection.
process.env.TZ = 'Asia/Kathmandu';
import { syncPending, getSapConfig } from '../src/lib/connector';
import { prisma } from '../src/lib/db';

const intervalSec = Number(process.env.SAP_WORKER_INTERVAL || 60);

async function tick() {
  try {
    const cfg = await getSapConfig();
    const { sent, failed } = await syncPending();
    if (sent || failed) {
      console.log(`[${new Date().toISOString()}] profile=${cfg.profile} sent=${sent} failed=${failed}`);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}] worker error:`, e);
  }
}

async function main() {
  const cfg = await getSapConfig();
  if (!cfg.enabled) {
    console.log('SAP posting is switched off (Admin → SAP Business One). Nothing to do — exiting.');
    await prisma.$disconnect();
    return;
  }
  console.log(`SAP worker started — profile=${cfg.profile}, interval=${intervalSec}s. Ctrl-C to stop.`);
  await tick();
  setInterval(tick, intervalSec * 1000);
}

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

void main();
