import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { resetUserPassword } from '@/server/users';
export const runtime = 'nodejs';
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await context(req, true),
      { id } = await params;
    return NextResponse.json(await resetUserPassword(ctx, id), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
