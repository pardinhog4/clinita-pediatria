import { commandRoute } from '@/server/route';
export const runtime = 'nodejs';

// Conferência do repasse do período.
export const POST = commandRoute('professionals', 'payout-review');
