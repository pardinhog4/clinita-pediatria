import { detailRoute, updateRoute } from '@/server/route';
export const runtime = 'nodejs';

export const GET = detailRoute('ledger');
export const PATCH = updateRoute('ledger');
