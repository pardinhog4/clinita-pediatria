import { uploadSandbox } from '@/server/sandbox';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Anexo (imagem ou PDF) enviado na conversa de teste.
export const POST = writeRoute<{ id: string }>((req, ctx, { id }) => uploadSandbox(req, ctx, id));
