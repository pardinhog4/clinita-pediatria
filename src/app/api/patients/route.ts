import { createRoute, listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Pacientes da unidade.
export const GET = listRoute('patients');
export const POST = createRoute('patients');
