import { commandRoute } from '@/server/route';
export const runtime = 'nodejs';

// Entrada ou saída de material.
export const POST = commandRoute('inventory', 'move');
