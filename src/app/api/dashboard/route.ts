import { dashboard } from '@/server/http';
import { route, unitParam } from '@/server/route';
export const runtime = 'nodejs';

// Indicadores do painel inicial.
export const GET = route((req, ctx) => dashboard(ctx, unitParam(req, ctx)));
