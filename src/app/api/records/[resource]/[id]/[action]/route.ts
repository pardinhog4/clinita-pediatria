import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import {
  setRecordActive,
  transferPatientUnit,
  removeDocument,
  recordHistory,
} from '@/server/lifecycle';
export const runtime = 'nodejs';
type Params = { params: Promise<{ resource: string; id: string; action: string }> };
const notFound = () => NextResponse.json({ error: 'Ação não encontrada.' }, { status: 404 });
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await context(req),
      { resource, id, action } = await params;
    if (action !== 'history') return notFound();
    return NextResponse.json(await recordHistory(ctx, resource, id), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await context(req, true),
      { resource, id, action } = await params;
    const body = await jsonInput(req);
    const data =
      resource === 'documents' && action === 'remove'
        ? await removeDocument(ctx, id, body)
        : resource === 'patients' && action === 'transfer-unit'
          ? await transferPatientUnit(ctx, id, body)
          : action === 'active'
            ? await setRecordActive(ctx, resource, id, body)
            : null;
    if (!data) return notFound();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e);
  }
}
