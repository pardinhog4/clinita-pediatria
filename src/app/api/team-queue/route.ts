import { teamQueue } from '@/server/conversation-workflow';
import { route, unitParam } from '@/server/route';
export const runtime = 'nodejs';

// Fila de conversas por equipe.
export const GET = route((req, ctx) => teamQueue(ctx, unitParam(req, ctx)));
