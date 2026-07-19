/**
 * API Route: Materialize Deal Truth Snapshot
 *
 * POST /api/deals/[dealId]/arbitration/materialize
 *
 * Compiles all arbitrated decisions into a single truth_json snapshot.
 */

import { NextRequest } from 'next/server';
import { getCurrentBankId } from '@/lib/tenant/getCurrentBankId';
import { materializeTruthSnapshotForDeal } from '@/lib/arbitration/materializeTruthSnapshot';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params;
    const bankId = await getCurrentBankId();

    if (!bankId) {
      return Response.json(
        { ok: false, error: 'Bank ID required' },
        { status: 400 }
      );
    }

    const data = await materializeTruthSnapshotForDeal(dealId, bankId);

    return Response.json({ ok: true, data });

  } catch (error) {
    console.error('[Arbitration Materialize] Error:', error);

    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
