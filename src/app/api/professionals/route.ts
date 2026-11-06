import { createRoute, listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Profissionais da unidade.
export const GET = listRoute('professionals');
export const POST = createRoute('professionals');
