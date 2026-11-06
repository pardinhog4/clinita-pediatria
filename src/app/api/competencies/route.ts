import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { competencyCatalog } from '@/server/professional-profiles';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await competencyCatalog(await context(req)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
