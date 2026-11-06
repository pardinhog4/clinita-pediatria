import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { getProfile, saveProfile } from '@/server/professional-profiles';
export const runtime = 'nodejs';
type Params = { params: Promise<{ id: string }> };
const noStore = { headers: { 'Cache-Control': 'no-store' } };
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    return NextResponse.json(await getProfile(await context(req), id), noStore);
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const ctx = await context(req, true),
      { id } = await params;
    return NextResponse.json(await saveProfile(ctx, id, await jsonInput(req)), noStore);
  } catch (e) {
    return failure(e);
  }
}
