import { ApiError } from '@/lib/errors';
import { readLimited } from '@/server/http';
import { runImport } from '@/server/importer';
import { writeRoute } from '@/server/route';
export const runtime = 'nodejs';

// Envio da planilha: commit=false só confere; commit=true grava (tudo ou nada).
export const POST = writeRoute(async (req, ctx) => {
  const bytes = await readLimited(req, 5 * 1048576 + 100000);
  const form = await new Response(new Uint8Array(bytes), {
    headers: { 'content-type': req.headers.get('content-type') || '' },
  }).formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size < 10)
    throw new ApiError(422, 'Escolha a planilha (.xlsx) preenchida.');
  if (file.size > 5 * 1048576) throw new ApiError(422, 'Planilha acima de 5 MB.');
  return runImport(
    ctx,
    String(form.get('kind') || ''),
    Buffer.from(await file.arrayBuffer()),
    form.get('commit') === 'true',
  );
});
