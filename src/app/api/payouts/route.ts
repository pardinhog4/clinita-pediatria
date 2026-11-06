import { payouts } from '@/server/http';
import { periodParams, route, unitParam } from '@/server/route';
export const runtime = 'nodejs';

// Repasses PJ do período.
export const GET = route((req, ctx) => payouts(ctx, unitParam(req, ctx), periodParams(req)));
