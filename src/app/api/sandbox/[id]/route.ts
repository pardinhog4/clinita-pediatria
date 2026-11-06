import { deleteSandbox, sandboxDetail } from '@/server/sandbox';
import { route, writeRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = route<{ id: string }>((_req, ctx, { id }) => sandboxDetail(ctx, id));
export const DELETE = writeRoute<{ id: string }>((_req, ctx, { id }) => deleteSandbox(ctx, id));
