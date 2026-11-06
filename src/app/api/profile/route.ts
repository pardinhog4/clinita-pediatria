import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { profile, updateProfile } from '@/server/auth';
export const runtime = 'nodejs';
const noStore = { headers: { 'Cache-Control': 'no-store' } };
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await profile(await context(req)), noStore);
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await context(req, true);
    return NextResponse.json(await updateProfile(ctx, await jsonInput(req)), noStore);
  } catch (e) {
    return failure(e);
  }
}
