import { detailRoute, updateRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = detailRoute('models');
export const PATCH = updateRoute('models');
