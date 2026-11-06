import { uploadDocument } from '@/server/http';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Envio de documento (laudo, pedido, comprovante) para o prontuário.
export const POST = writeRoute((req, ctx) => uploadDocument(req, ctx), 201);
