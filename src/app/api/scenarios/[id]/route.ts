import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { scenarioDetail, saveScenario } from '@/server/scenarios';
export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await context(req),
      { id } = await params;
    return NextResponse.json(await scenarioDetail(ctx, id), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await context(req, true),
      { id } = await params;
    return NextResponse.json(await saveScenario(ctx, id, await jsonInput(req)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
