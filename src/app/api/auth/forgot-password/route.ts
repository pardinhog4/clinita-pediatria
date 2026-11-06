import { NextRequest, NextResponse } from 'next/server';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { requestPasswordReset } from '@/server/access-links';
export const runtime = 'nodejs';

// "Esqueci minha senha": envia um link de uso único (1 h). Responde igual exista ou não a conta.
export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(await requestPasswordReset(req, await jsonInput(req)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
