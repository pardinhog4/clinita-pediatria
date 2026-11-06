import { waitlist } from '@/server/operations-read';
import { route, unitParam } from '@/server/route';
export const runtime = 'nodejs';

// Lista de espera da unidade.
export const GET = route((req, ctx) => waitlist(ctx, unitParam(req, ctx)));
