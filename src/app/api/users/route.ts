import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { listUsers, createUser } from '@/server/users';
export const runtime = 'nodejs';
const noStore = { headers: { 'Cache-Control': 'no-store' } };
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(
      await listUsers(await context(req), req.nextUrl.searchParams),
      noStore,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = await context(req, true);
    return NextResponse.json(await createUser(ctx, await jsonInput(req)), {
      status: 201,
      ...noStore,
    });
  } catch (e) {
    return failure(e);
  }
}
