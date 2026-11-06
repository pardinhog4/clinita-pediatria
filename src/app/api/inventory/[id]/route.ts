import { detailRoute, updateRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = detailRoute('inventory');
export const PATCH = updateRoute('inventory');
