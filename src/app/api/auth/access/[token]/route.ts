import { NextRequest, NextResponse } from 'next/server';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { accessLinkInfo, useAccessLink } from '@/server/access-links';
export const runtime = 'nodejs';
type Params = { params: Promise<{ token: string }> };
const noStore = { headers: { 'Cache-Control': 'no-store' } };

// Link de convite ou de recuperação: GET confere o link, POST define a senha.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    return NextResponse.json(await accessLinkInfo((await params).token), noStore);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest, { params }: Params) {
  try {
    return NextResponse.json(
      await useAccessLink(req, (await params).token, await jsonInput(req)),
      noStore,
    );
  } catch (e) {
    return failure(e);
  }
}
