import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { listReferrals } from '@/server/referrals';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  try {
    const ctx = await context(req);
    return NextResponse.json(await listReferrals(ctx, req.nextUrl.searchParams), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
