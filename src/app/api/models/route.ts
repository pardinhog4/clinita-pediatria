import { createRoute, listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Modelos clínicos de avaliação.
export const GET = listRoute('models');
export const POST = createRoute('models');
