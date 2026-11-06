import { NextRequest, NextResponse } from 'next/server';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { runSetup, setupStatus } from '@/server/setup';
export const runtime = 'nodejs';
const noStore = { headers: { 'Cache-Control': 'no-store' } };

// Cadastro inicial da clínica: GET diz se está disponível; POST cria a clínica e a direção.
export async function GET() {
  try {
    return NextResponse.json(await setupStatus(), noStore);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(await runSetup(req, await jsonInput(req)), noStore);
  } catch (e) {
    return failure(e);
  }
}
