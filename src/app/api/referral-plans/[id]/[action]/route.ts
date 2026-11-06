import { NextRequest, NextResponse } from 'next/server';
import { context } from '@/lib/security';
import { failure } from '@/lib/errors';
import { jsonInput } from '@/server/http';
import { suggestSchedule, createReferralProposal, checkSlots } from '@/server/referral-scheduling';
export const runtime = 'nodejs';
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    const ctx = await context(req, true),
      { id, action } = await params;
    const body = await jsonInput(req);
    const data =
      action === 'schedule'
        ? await suggestSchedule(ctx, id, body)
        : action === 'check'
          ? await checkSlots(ctx, id, body)
          : action === 'proposal'
            ? await createReferralProposal(ctx, id, body)
            : null;
    if (!data) return NextResponse.json({ error: 'Ação não encontrada.' }, { status: 404 });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e);
  }
}
