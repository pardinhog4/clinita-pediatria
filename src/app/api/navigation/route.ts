import { navigationCounts } from '@/server/operations-read';
import { route, unitParam } from '@/server/route';
export const runtime = 'nodejs';

// Contadores de pendências exibidos no menu.
export const GET = route((req, ctx) => navigationCounts(ctx, unitParam(req, ctx)));
