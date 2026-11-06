import { NextRequest, NextResponse } from 'next/server';
import { context, type Context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { list } from './repository';
import { command, create, detail, update } from './service';
import { jsonInput } from './http';

// Base de todas as rotas da API: autentica a sessão, valida a origem nas gravações,
// responde JSON sem cache e converte erros no formato padrão (failure).

type RouteContext<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: Context, params: P) => Promise<unknown>;
type Options = { write?: boolean; status?: number };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Cria um handler de rota. Se o handler devolver um Response (ex.: download), ele é repassado. */
export function route<P = Record<string, string>>(handler: Handler<P>, options: Options = {}) {
  return async (req: NextRequest, { params }: RouteContext<P>) => {
    try {
      const ctx = await context(req, options.write ?? false);
      const result = await handler(req, ctx, await params);
      return result instanceof Response ? result : json(result, options.status);
    } catch (e) {
      return failure(e);
    }
  };
}

/** Rota que grava dados: exige origem válida (proteção CSRF). */
export function writeRoute<P = Record<string, string>>(handler: Handler<P>, status = 200) {
  return route(handler, { write: true, status });
}

/** Unidade pedida na URL (?unit=) ou a primeira unidade do usuário. */
export function unitParam(req: NextRequest, ctx: Context) {
  return req.nextUrl.searchParams.get('unit') || ctx.unitIds[0];
}

/** Período opcional (?from=&to=) usado nos relatórios de repasse. */
export function periodParams(req: NextRequest) {
  return { from: req.nextUrl.searchParams.get('from'), to: req.nextUrl.searchParams.get('to') };
}

// Rotas de cadastro (patients, professionals, appointments...): listagem, criação, detalhe,
// edição e comandos. As regras de cada recurso ficam em repository.ts e service.ts.

export const listRoute = (resource: string) =>
  route((req, ctx) => list(ctx, resource, req.nextUrl.searchParams));

export const createRoute = (resource: string) =>
  writeRoute(async (req, ctx) => create(ctx, resource, await jsonInput(req)), 201);

export const detailRoute = (resource: string) =>
  route<{ id: string }>((_req, ctx, { id }) => detail(ctx, resource, id));

export const updateRoute = (resource: string) =>
  writeRoute<{ id: string }>(async (req, ctx, { id }) =>
    update(ctx, resource, id, await jsonInput(req)),
  );

export const commandRoute = (resource: string, action: string) =>
  writeRoute<{ id: string }>(async (req, ctx, { id }) =>
    command(ctx, resource, id, action, await jsonInput(req)),
  );
