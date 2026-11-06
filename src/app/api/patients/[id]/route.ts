import { detailRoute, updateRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = detailRoute('patients');
export const PATCH = updateRoute('patients');
