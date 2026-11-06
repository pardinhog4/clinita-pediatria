import { createRoute, listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Materiais em estoque.
export const GET = listRoute('inventory');
export const POST = createRoute('inventory');
