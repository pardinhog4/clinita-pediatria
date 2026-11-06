import { jsonInput } from '@/server/http';
import { sendTestEmail } from '@/server/mail';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Envia um e-mail de teste para conferir a configuração do SMTP.
export const POST = writeRoute(async (req, ctx) => sendTestEmail(ctx, await jsonInput(req)));
