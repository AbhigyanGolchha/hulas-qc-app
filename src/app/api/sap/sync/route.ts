// Drain the integration outbox once. Called by the "Sync now" button and by
// scripts/sap-worker.ts on its polling loop (with the worker secret).
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { syncPending } from '@/lib/connector';

export async function POST(req: NextRequest) {
  const workerSecret = process.env.SAP_WORKER_SECRET;
  const isWorker = workerSecret && req.headers.get('x-worker-secret') === workerSecret;
  if (!isWorker) {
    const user = await getSessionUser();
    if (!user || !user.permissions.includes('admin.sap')) return NextResponse.json({ error: 'Your role may not run SAP sync' }, { status: 403 });
  }
  const result = await syncPending();
  return NextResponse.json(result);
}
