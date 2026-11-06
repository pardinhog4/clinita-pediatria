import { commandRoute } from '@/server/route';
export const runtime = 'nodejs';

// Envia mensagem da equipe na conversa.
export const POST = commandRoute('conversations', 'messages');
