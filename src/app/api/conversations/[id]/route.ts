import { detailRoute, updateRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = detailRoute('conversations');
export const PATCH = updateRoute('conversations');
