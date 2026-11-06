import { detailRoute, updateRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = detailRoute('appointments');
export const PATCH = updateRoute('appointments');
