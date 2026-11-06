import { createSandbox, listSandbox } from '@/server/sandbox';
import { jsonInput } from '@/server/http';
import { route, unitParam, writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Conversas de teste com a IA.
export const GET = route((req, ctx) => listSandbox(ctx, unitParam(req, ctx)));
export const POST = writeRoute(async (req, ctx) => createSandbox(ctx, await jsonInput(req)), 201);
