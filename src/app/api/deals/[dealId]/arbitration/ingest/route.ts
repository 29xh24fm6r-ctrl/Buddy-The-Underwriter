/**
 * API Route: Ingest Agent Findings into Claims
 *
 * POST /api/deals/[dealId]/arbitration/ingest
 *
 * Normalizes agent findings into claims and creates conflict sets.
 */

import { NextRequest } from 'next/server';
import { getCurrentBankId } from '@/lib/tenant/getCurrentBankId';
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
    const bankId = await getCurrentBankId();

    if (!bankId) {
      return Response.json(
        { ok: false, error: 'Bank ID required' },
        { status: 400 }
      );
    }

    const body = (await req.json()) as IngestRequest;

    const data = await ingestClaimsForDeal(dealId, bankId, { findingIds: body.finding_ids });

    return Response.json({ ok: true, data });

  } catch (error) {
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
