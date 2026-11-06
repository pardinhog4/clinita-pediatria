import { NextRequest } from 'next/server';
import { rotate } from '@/lib/security';
import { ApiError, failure } from '@/lib/errors';
export const runtime = 'nodejs';

// Renova a sessão (token de acesso de 15 min a partir do token de renovação de 7 dias).
// Se a renovação for recusada, apaga os cookies: a sessão acabou e o front volta ao login.
export async function POST(req: NextRequest) {
  try {
    return await rotate(req);
  } catch (e) {
    const response = failure(e);
    if (e instanceof ApiError && e.status === 401)
      for (const [name, path] of [
        ['integrar_access', '/'],
        ['integrar_refresh', '/api/auth'],
        ['integrar_csrf', '/'],
      ])
        response.cookies.set(name, '', { maxAge: 0, path });
    return response;
  }
}
