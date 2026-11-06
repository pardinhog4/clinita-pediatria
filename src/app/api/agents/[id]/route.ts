import { detailRoute, updateRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = detailRoute('agents');
export const PATCH = updateRoute('agents');
