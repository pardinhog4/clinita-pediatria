import { directory } from '@/server/directory';
import { route } from '@/server/route';
export const runtime = 'nodejs';

// Busca de pacientes e profissionais para seleção.
export const GET = route((req, ctx) => directory(ctx, req.nextUrl.searchParams));
