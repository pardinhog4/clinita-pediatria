import { NextRequest, NextResponse } from 'next/server';
import { context, logout } from '@/lib/security';
import { failure } from '@/lib/errors';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(
      { user: await context(req) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: NextRequest) {
  try {
    return await logout(req);
  } catch (e) {
    return failure(e);
  }
}
