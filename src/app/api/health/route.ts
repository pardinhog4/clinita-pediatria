import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
export const runtime = 'nodejs';
export async function GET() {
  try {
    await query('SELECT 1');
    return NextResponse.json(
      {
        status: 'ok',
        database: 'postgresql',
        application: 'integrar',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }
}
