import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { changePassword } from '@/server/auth';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    const ctx = await context(req, true);
    return NextResponse.json(await changePassword(ctx, await jsonInput(req)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
