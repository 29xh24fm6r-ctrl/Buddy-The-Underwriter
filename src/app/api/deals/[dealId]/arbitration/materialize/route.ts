/**
 * API Route: Materialize Deal Truth Snapshot
 *
 * POST /api/deals/[dealId]/arbitration/materialize
 *
 * Compiles all arbitrated decisions into a single truth_json snapshot.
 */

import { NextRequest } from 'next/server';
import { assertDealAccess } from '@/lib/server/deal-access';
import { accessErrorToResponse } from '@/lib/server/withDealAccess';
import { materializeTruthSnapshotForDeal } from '@/lib/arbitration/materializeTruthSnapshot';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params;
    // assertDealAccess derives bankId from the caller's own authenticated
    // session and verifies it against the deal's real bank_id — dealId
    // alone (from the URL) is never trusted to resolve tenant scope.
    const { bankId } = await assertDealAccess(dealId);

    const data = await materializeTruthSnapshotForDeal(dealId, bankId);

    return Response.json({ ok: true, data });

  } catch (error) {
    const accessRes = accessErrorToResponse(error);
    if (accessRes) return accessRes;

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
