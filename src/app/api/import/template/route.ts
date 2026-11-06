import { importTemplate } from '@/server/importer';
import { route } from '@/server/route';
export const runtime = 'nodejs';

// Modelo .xlsx da importação (?kind=insurers|professionals|patients).
export const GET = route(async (req, ctx) => {
  const { buffer, filename } = await importTemplate(
    ctx,
    req.nextUrl.searchParams.get('kind') || '',
  );
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
