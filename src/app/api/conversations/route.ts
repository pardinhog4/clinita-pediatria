import { createRoute, listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Conversas de atendimento (WhatsApp).
export const GET = listRoute('conversations');
export const POST = createRoute('conversations');
