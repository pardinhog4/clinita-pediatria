import { proposals } from '@/server/conversation-workflow';
import { route, unitParam } from '@/server/route';
export const runtime = 'nodejs';

// Propostas de horário em aberto nas conversas.
export const GET = route((req, ctx) => proposals(ctx, unitParam(req, ctx)));
