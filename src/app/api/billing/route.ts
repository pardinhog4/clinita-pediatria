import { billing } from '@/server/operations-read';
import { route, unitParam } from '@/server/route';
export const runtime = 'nodejs';

// Auditoria e lotes de faturamento TISS.
export const GET = route((req, ctx) => billing(ctx, unitParam(req, ctx)));
