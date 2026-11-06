import { createRoute, listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Lançamentos financeiros (contas a pagar e a receber).
export const GET = listRoute('ledger');
export const POST = createRoute('ledger');
