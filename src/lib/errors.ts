import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function failure(e: unknown) {
  if (e instanceof ZodError)
    return NextResponse.json(
      { error: 'Confira os campos informados.', fields: e.flatten().fieldErrors },
      { status: 422 },
    );
  if (e instanceof ApiError)
    return NextResponse.json(
      { error: e.message },
      { status: e.status, headers: e.status === 429 ? { 'Retry-After': '60' } : {} },
    );
  if (
    typeof e === 'object' &&
    e &&
    'code' in e &&
    ['23505', '23503', '23514', '40001', '40P01'].includes(String(e.code))
  )
    return NextResponse.json(
      { error: 'A operação conflita com os dados atuais. Atualize e confira os registros.' },
      { status: 409 },
    );
  console.error('api_error', e instanceof Error ? e.message : 'unknown');
  return NextResponse.json({ error: 'Não foi possível concluir a operação.' }, { status: 500 });
}
