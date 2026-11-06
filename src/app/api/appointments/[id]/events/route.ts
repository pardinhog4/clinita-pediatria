import { commandRoute } from '@/server/route';
export const runtime = 'nodejs';

// Eventos do atendimento (chegada, início, conclusão, falta).
export const POST = commandRoute('appointments', 'events');
