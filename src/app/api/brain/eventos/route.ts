import { handleBrainEvent } from '@/server/brain/webhook';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Eventos do brain-desk (webhooks assinados).
export const POST = (req: Request) => handleBrainEvent(req);
