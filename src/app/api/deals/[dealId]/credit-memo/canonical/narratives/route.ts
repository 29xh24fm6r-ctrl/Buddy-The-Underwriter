import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { assembleNarratives, overlayNarratives } from "@/lib/creditMemo/canonical/narrativeAssembly";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    const bankId = access.bankId;

    const body = await req.json().catch(() => ({}));
    const forceRegenerate = body?.force === true;

    // Build the deterministic memo first
    const memoResult = await buildCanonicalCreditMemo({ dealId, bankId });
    if (!memoResult.ok) {
      return NextResponse.json({ ok: false, error: memoResult.error }, { status: 400 });
    }

    // Generate narratives
    const narratives = await assembleNarratives({
      memo: memoResult.memo,
      forceRegenerate,
    });

    // Overlay onto memo
    const enrichedMemo = overlayNarratives(memoResult.memo, narratives);

    return NextResponse.json({
      ok: true,
      narratives,
      memo: enrichedMemo,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[credit-memo/canonical/narratives POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
