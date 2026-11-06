import { createRoute, listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Salas e capacidade.
export const GET = listRoute('rooms');
export const POST = createRoute('rooms');
