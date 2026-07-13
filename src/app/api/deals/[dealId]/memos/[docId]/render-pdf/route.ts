import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/deals/[dealId]/memos/[docId]/render-pdf
 *
 * Deprecated alongside /api/deals/[dealId]/memos/generate — see that file's
 * docblock. This route could previously mark a `generated_documents` row
 * `status: "final"` with zero completeness/safety checks (and had no
 * deal-ownership check at all), independent of the certified Florida Armory
 * pipeline. Neutered rather than left reachable.
 */
export async function POST(
  _req: NextRequest,
  _ctx: { params: Promise<{ dealId: string; docId: string }> },
) {
  return NextResponse.json(
    {
      error: "deprecated_use_canonical_credit_memo",
      message:
        "This memo-rendering path is deprecated. Use the canonical credit memo flow: GET /api/deals/{dealId}/credit-memo/canonical/pdf.",
    },
    { status: 410 },
  );
}
