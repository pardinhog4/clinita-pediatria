import { downloadDocument } from '@/server/http';
import { route } from '@/server/route';
export const runtime = 'nodejs';

// Download do documento, com checagem de acesso.
export const GET = route<{ id: string }>((_req, ctx, { id }) => downloadDocument(ctx, id));
