import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { saveProcedure } from '@/server/lifecycle';
export const runtime = 'nodejs';
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ insurerId: string; procedureId: string }> },
) {
  try {
    const ctx = await context(req, true),
      { insurerId, procedureId } = await params;
    return NextResponse.json(
      await saveProcedure(ctx, insurerId, procedureId, await jsonInput(req)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
