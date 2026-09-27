// Runs once when the Next.js server starts (dev and `npm run start`).
// Applies the one-time data fixes in src/lib/data-fixes.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { runDataFixes } = await import('./lib/data-fixes');
  try {
    await runDataFixes();
  } catch (e) {
    // never keep the app from starting over a data fix — it retries next start
    console.error('[data-fix] failed:', e);
  }
}
