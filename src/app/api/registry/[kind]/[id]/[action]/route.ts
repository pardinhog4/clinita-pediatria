import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { setRegistryActive } from '@/server/registries';
export const runtime = 'nodejs';
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string; action: string }> },
) {
  try {
    const ctx = await context(req, true),
      { kind, id, action } = await params;
    if (action !== 'active')
      return NextResponse.json({ error: 'Ação não encontrada.' }, { status: 404 });
    return NextResponse.json(await setRegistryActive(ctx, kind, id, await jsonInput(req)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
