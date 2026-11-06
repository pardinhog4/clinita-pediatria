import { createRoute, listRoute } from '@/server/route';
export const runtime = 'nodejs';

// Agentes de IA versionados.
export const GET = listRoute('agents');
export const POST = createRoute('agents');
