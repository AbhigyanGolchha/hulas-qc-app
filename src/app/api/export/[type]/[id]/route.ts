// SAP-readiness export: returns the record as clean JSON shaped for SAP QM /
// production confirmations, and records the payload in the integration outbox.
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { exportToOutbox } from '@/lib/sap';

export async function GET(_req: NextRequest, { params }: { params: { type: string; id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const t = params.type;
  if (t !== 'intake' && t !== 'qc' && t !== 'production') {
    return NextResponse.json({ error: 'Unknown type' }, { status: 404 });
  }
  try {
    const payload = await exportToOutbox(t === 'intake' ? 'INTAKE' : t === 'qc' ? 'QC' : 'PRODUCTION', params.id);
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }
}
