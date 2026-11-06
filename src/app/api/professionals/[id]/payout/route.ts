import { commandRoute } from '@/server/route';
export const runtime = 'nodejs';

// Registro manual do pagamento do repasse.
export const POST = commandRoute('professionals', 'payout');
