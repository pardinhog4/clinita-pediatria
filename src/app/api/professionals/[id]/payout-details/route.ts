import { payoutDetails } from '@/server/payouts';
import { periodParams, route } from '@/server/route';
export const runtime = 'nodejs';

// Sessões que compõem o repasse do profissional no período.
export const GET = route<{ id: string }>((req, ctx, { id }) =>
  payoutDetails(ctx, id, periodParams(req)),
);
