/**
 * API Route: Reconcile Conflict Sets
 *
 * POST /api/deals/[dealId]/arbitration/reconcile
 *
 * Applies arbitration rules R0-R5 to resolve conflicts.
 */

import { NextRequest } from 'next/server';
import { assertDealAccess } from '@/lib/server/deal-access';
import { accessErrorToResponse } from '@/lib/server/withDealAccess';
import { reconcileConflictsForDeal } from '@/lib/arbitration/reconcileConflicts';

interface ReconcileRequest {
  apply_bank_overlay?: boolean;
}

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

    const body = (await req.json()) as ReconcileRequest;

    const data = await reconcileConflictsForDeal(dealId, bankId, {
      applyBankOverlay: body.apply_bank_overlay,
    });

    return Response.json({ ok: true, data });

  } catch (error) {
    const accessRes = accessErrorToResponse(error);
    if (accessRes) return accessRes;

    console.error('[Arbitration Reconcile] Error:', error);

    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
