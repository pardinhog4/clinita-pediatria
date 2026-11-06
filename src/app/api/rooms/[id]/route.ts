import { detailRoute, updateRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = detailRoute('rooms');
export const PATCH = updateRoute('rooms');
