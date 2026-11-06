import { detailRoute, updateRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = detailRoute('professionals');
export const PATCH = updateRoute('professionals');
