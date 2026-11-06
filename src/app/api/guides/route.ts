import { guides } from '@/server/operations-read';
import { route, unitParam } from '@/server/route';
export const runtime = 'nodejs';

// Guias, tokens, assinaturas e créditos.
export const GET = route((req, ctx) => guides(ctx, unitParam(req, ctx)));
