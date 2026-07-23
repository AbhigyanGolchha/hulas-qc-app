// Drain the integration outbox once. Called by the "Sync now" button and by
// scripts/sap-worker.ts on its polling loop (with the worker secret).
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canApprove } from '@/lib/constants';
import { syncPending } from '@/lib/connector';

export async function POST(req: NextRequest) {
  const workerSecret = process.env.SAP_WORKER_SECRET;
  const isWorker = workerSecret && req.headers.get('x-worker-secret') === workerSecret;
  if (!isWorker) {
    const user = await getSessionUser();
    if (!user || !canApprove(user.role)) return NextResponse.json({ error: 'Manager/Admin only' }, { status: 403 });
  }
  const result = await syncPending();
  return NextResponse.json(result);
}
