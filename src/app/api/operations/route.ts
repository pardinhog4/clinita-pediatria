import { operation } from '@/server/operations';
import { jsonInput } from '@/server/http';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Operações do dia a dia (faltas, reposições, configurações, lotes...), validadas em operations.ts.
export const POST = writeRoute(async (req, ctx) => operation(ctx, await jsonInput(req)), 201);
