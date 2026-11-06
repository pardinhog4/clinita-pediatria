import { appMeta } from '@/server/http';
import { route } from '@/server/route';
export const runtime = 'nodejs';

// Sessão, unidades e especialidades do usuário logado.
export const GET = route((_req, ctx) => appMeta(ctx));
