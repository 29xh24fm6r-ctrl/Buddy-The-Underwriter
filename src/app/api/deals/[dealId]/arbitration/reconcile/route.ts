/**
 * API Route: Reconcile Conflict Sets
 *
 * POST /api/deals/[dealId]/arbitration/reconcile
 *
 * Applies arbitration rules R0-R5 to resolve conflicts.
 */

import { NextRequest } from 'next/server';
import { getCurrentBankId } from '@/lib/tenant/getCurrentBankId';
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
    const bankId = await getCurrentBankId();

    if (!bankId) {
      return Response.json(
        { ok: false, error: 'Bank ID required' },
        { status: 400 }
      );
    }

    const body = (await req.json()) as ReconcileRequest;

    const data = await reconcileConflictsForDeal(dealId, bankId, {
      applyBankOverlay: body.apply_bank_overlay,
    });

    return Response.json({ ok: true, data });

  } catch (error) {
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
