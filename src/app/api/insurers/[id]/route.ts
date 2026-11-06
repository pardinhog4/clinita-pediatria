import { detailRoute, updateRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = detailRoute('insurers');
export const PATCH = updateRoute('insurers');
