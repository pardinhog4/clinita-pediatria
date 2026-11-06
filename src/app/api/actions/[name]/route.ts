import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { actions } from '@/server/operational-lifecycle';
export const runtime = 'nodejs';
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const ctx = await context(req, true),
      { name } = await params;
    const run = actions[name];
    if (!run) return NextResponse.json({ error: 'Ação não encontrada.' }, { status: 404 });
    return NextResponse.json(await run(ctx, await jsonInput(req)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
