import { humanSandboxMessage } from '@/server/sandbox';
import { jsonInput } from '@/server/http';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Resposta escrita por uma pessoa da equipe.
export const POST = writeRoute<{ id: string }>(async (req, ctx, { id }) =>
  humanSandboxMessage(ctx, id, await jsonInput(req)),
);
