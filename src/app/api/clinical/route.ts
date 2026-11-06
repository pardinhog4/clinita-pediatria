import { createRoute } from '@/server/route';
export const runtime = 'nodejs';

// Registro clínico de um atendimento (evolução, avaliação).
export const POST = createRoute('clinical');
