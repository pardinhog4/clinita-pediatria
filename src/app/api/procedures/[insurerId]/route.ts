import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { listProcedures, saveProcedure } from '@/server/lifecycle';
export const runtime = 'nodejs';
type Params = { params: Promise<{ insurerId: string }> };
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await context(req),
      { insurerId } = await params;
    return NextResponse.json(await listProcedures(ctx, insurerId), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await context(req, true),
      { insurerId } = await params;
    return NextResponse.json(await saveProcedure(ctx, insurerId, null, await jsonInput(req)), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
