import { resendInvite } from '@/server/users';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Reenvia o convite por e-mail para a pessoa definir a própria senha.
export const POST = writeRoute<{ id: string }>((_req, ctx, { id }) => resendInvite(ctx, id));
