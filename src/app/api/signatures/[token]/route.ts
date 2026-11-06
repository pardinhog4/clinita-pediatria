import { NextRequest, NextResponse } from 'next/server';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { signatureInfo, signGuide } from '@/server/signatures';
export const runtime = 'nodejs';
type Params = { params: Promise<{ token: string }> };
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    return NextResponse.json(await signatureInfo((await params).token), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest, { params }: Params) {
  try {
    return NextResponse.json(await signGuide(req, (await params).token, await jsonInput(req)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
