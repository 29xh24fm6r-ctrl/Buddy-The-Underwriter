/**
 * API Route: Ingest Agent Findings into Claims
 *
 * POST /api/deals/[dealId]/arbitration/ingest
 *
 * Normalizes agent findings into claims and creates conflict sets.
 */

import { NextRequest } from 'next/server';
import { assertDealAccess } from '@/lib/server/deal-access';
import { accessErrorToResponse } from '@/lib/server/withDealAccess';
import { ingestClaimsForDeal } from '@/lib/arbitration/ingestClaims';

interface IngestRequest {
  finding_ids?: string[]; // Specific findings to ingest
  auto_reconcile?: boolean; // Auto-trigger reconciliation
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

    const body = (await req.json()) as IngestRequest;

    const data = await ingestClaimsForDeal(dealId, bankId, { findingIds: body.finding_ids });

    return Response.json({ ok: true, data });

  } catch (error) {
    const accessRes = accessErrorToResponse(error);
    if (accessRes) return accessRes;

    console.error('[Arbitration Ingest] Error:', error);

    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
