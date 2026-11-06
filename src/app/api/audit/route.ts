import { listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Log de auditoria (somente leitura).
export const GET = listRoute('audit');
