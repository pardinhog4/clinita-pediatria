import { createRoute, listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Agendamentos da unidade (criação aceita recorrência).
export const GET = listRoute('appointments');
export const POST = createRoute('appointments');
