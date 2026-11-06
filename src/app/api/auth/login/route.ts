import { NextRequest } from 'next/server';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { login } from '@/server/auth';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    return await login(req, await jsonInput(req));
  } catch (e) {
    return failure(e);
  }
}
