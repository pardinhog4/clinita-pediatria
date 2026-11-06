import { commandRoute } from '@/server/route';
export const runtime = 'nodejs';

// Transfere a conversa para outra fila ou pessoa.
export const POST = commandRoute('conversations', 'transfer');
