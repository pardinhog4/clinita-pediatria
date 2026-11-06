import { sandboxAttachment } from '@/server/sandbox';
import { route } from '@/server/route';
export const runtime = 'nodejs';

// Download de um anexo da conversa de teste.
export const GET = route<{ id: string }>((req, ctx, { id }) =>
  sandboxAttachment(ctx, id, req.nextUrl.searchParams.get('attachment') || ''),
);
