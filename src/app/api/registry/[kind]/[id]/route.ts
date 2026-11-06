import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { saveRegistry } from '@/server/registries';
export const runtime = 'nodejs';
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const ctx = await context(req, true),
      { kind, id } = await params;
    return NextResponse.json(await saveRegistry(ctx, kind, id, await jsonInput(req)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
