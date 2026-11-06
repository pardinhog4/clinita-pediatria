import { commandRoute } from '@/server/route';
export const runtime = 'nodejs';

// Estorno da baixa do lançamento.
export const POST = commandRoute('ledger', 'reverse');
