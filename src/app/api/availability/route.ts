import { availability } from '@/server/http';
import { route } from '@/server/route';
export const runtime = 'nodejs';

// Horários livres por especialidade e duração.
export const GET = route((req, ctx) => availability(ctx, req.nextUrl.searchParams));
