import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { listRegistry, saveRegistry } from '@/server/registries';
export const runtime = 'nodejs';
type Params = { params: Promise<{ kind: string }> };
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await context(req),
      { kind } = await params;
    return NextResponse.json(await listRegistry(ctx, kind, req.nextUrl.searchParams), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await context(req, true),
      { kind } = await params;
    return NextResponse.json(await saveRegistry(ctx, kind, null, await jsonInput(req)), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
