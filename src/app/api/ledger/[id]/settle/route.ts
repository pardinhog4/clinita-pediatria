import { commandRoute } from '@/server/route';
export const runtime = 'nodejs';

// Baixa manual do lançamento.
export const POST = commandRoute('ledger', 'settle');
