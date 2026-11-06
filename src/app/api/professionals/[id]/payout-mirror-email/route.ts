import { jsonInput } from '@/server/http';
import { sendPayoutMirror } from '@/server/payouts';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Envia o espelho de repasse do período por e-mail ao profissional.
export const POST = writeRoute<{ id: string }>(async (req, ctx, { id }) => {
  const input = await jsonInput(req);
  return sendPayoutMirror(ctx, id, { from: input.from || null, to: input.to || null });
});
