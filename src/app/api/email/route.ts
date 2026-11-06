import { emailOutbox } from '@/server/mail';
import { route } from '@/server/route';
export const runtime = 'nodejs';

// Situação do e-mail (SMTP ou simulação) e últimos envios da clínica.
export const GET = route((_req, ctx) => emailOutbox(ctx));
