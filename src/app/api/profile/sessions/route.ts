import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { sessions, revokeOtherSessions } from '@/server/auth';
export const runtime = 'nodejs';
const noStore = { headers: { 'Cache-Control': 'no-store' } };
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await sessions(await context(req)), noStore);
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: NextRequest) {
  try {
    return NextResponse.json(await revokeOtherSessions(await context(req, true)), noStore);
  } catch (e) {
    return failure(e);
  }
}
