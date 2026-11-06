import { enqueueSandbox } from '@/server/sandbox';
import { jsonInput } from '@/server/http';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Mensagem da família, enfileirada para a IA responder.
export const POST = writeRoute<{ id: string }>(async (req, ctx, { id }) =>
  enqueueSandbox(ctx, id, await jsonInput(req)),
);
