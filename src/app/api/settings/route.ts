import { settings } from '@/server/operations-read';
import { route } from '@/server/route';
export const runtime = 'nodejs';

// Configurações operacionais da clínica.
export const GET = route((_req, ctx) => settings(ctx));
