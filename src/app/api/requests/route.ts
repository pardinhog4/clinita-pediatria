import { operationRequests } from '@/server/operations-read';
import { route, unitParam } from '@/server/route';
export const runtime = 'nodejs';

// Solicitações operacionais pendentes.
export const GET = route((req, ctx) => operationRequests(ctx, unitParam(req, ctx)));
