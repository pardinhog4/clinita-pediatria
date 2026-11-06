import { createRoute, listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Convênios e regras de autorização.
export const GET = listRoute('insurers');
export const POST = createRoute('insurers');
