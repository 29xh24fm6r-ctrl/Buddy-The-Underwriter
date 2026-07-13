import { NextRequest, NextResponse } from "next/server";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

// route-class: CLERK (SPEC-SEC-1)

/**
 * POST /api/deals/[dealId]/memos/generate
 *
 * Deprecated: this generated a `generated_documents` row (doc_type
 * "credit_memo") that render-pdf/route.ts could mark "final" with ZERO
 * completeness/safety checks — a real gap next to the certified Florida
 * Armory pipeline (buildCanonicalCreditMemo -> buildFloridaArmorySnapshot ->
 * assertCommitteeMemoSafe -> credit_memo_snapshots). This system is already
 * effectively dead in the live UI (the native component that called it,
 * DealMemoTemplateClient.tsx, is explicitly forbidden by
 * src/lib/__tests__/stitchNativeFallbackGuard.test.ts), so this route is
 * neutered rather than silently left reachable.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    await assertDealAccess(dealId);

    return NextResponse.json(
      {
        error: "deprecated_use_canonical_credit_memo",
        message:
          "This memo-generation path is deprecated. Use the canonical credit memo flow: POST /api/deals/{dealId}/credit-memo/generate and /submit.",
      },
      { status: 410 },
    );
  } catch (error) {
    const accessRes = accessErrorToResponse(error);
    if (accessRes) return accessRes;
    console.error("Error in deprecated memo generate route:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
