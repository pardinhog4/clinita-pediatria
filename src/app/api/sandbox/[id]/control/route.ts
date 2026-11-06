import { controlSandbox } from '@/server/sandbox';
import { jsonInput } from '@/server/http';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Pausar ou retomar a IA na conversa.
export const POST = writeRoute<{ id: string }>(async (req, ctx, { id }) =>
  controlSandbox(ctx, id, await jsonInput(req)),
);
