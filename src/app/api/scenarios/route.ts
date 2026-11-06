import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { listScenarios, saveScenario } from '@/server/scenarios';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  try {
    const ctx = await context(req);
    return NextResponse.json(await listScenarios(ctx, req.nextUrl.searchParams), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = await context(req, true);
    return NextResponse.json(await saveScenario(ctx, null, await jsonInput(req)), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
