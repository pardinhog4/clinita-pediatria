import { createSignatureLink } from '@/server/signatures';
import { jsonInput } from '@/server/http';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Gera o link de assinatura da guia para o responsável.
export const POST = writeRoute(async (req, ctx) => {
  const input = await jsonInput(req);
  return createSignatureLink(ctx, input.unit_id, input.appointment_id);
}, 201);
