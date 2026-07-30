import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { assembleNarratives, overlayNarratives } from "@/lib/creditMemo/canonical/narrativeAssembly";
import { verifyMemoNarratives } from "@/lib/creditMemo/canonical/verifyMemoNarratives";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    const { narratives, aiError } = await assembleNarratives({
      memo: memoResult.memo,
      forceRegenerate,
    });

    // Overlay onto memo
    const enrichedMemo = overlayNarratives(memoResult.memo, narratives);

    // SPEC-M8 ARTIFACT-PIPELINE-1: independent fact-check of the narrative
    // bundle against the same deterministic memo fields the generator saw.
    // Best-effort — a verifier outage must not block the memo from
    // rendering (the generator's output already succeeded or fell back).
    let verification = null;
    try {
      verification = await verifyMemoNarratives({
        dealId,
        bankId,
        memo: memoResult.memo,
        narratives,
        sb: supabaseAdmin(),
      });
    } catch (err) {
      console.error("[credit-memo/canonical/narratives] verification failed (non-fatal):", err);
    }

    return NextResponse.json({
      ok: true,
      narratives,
      memo: enrichedMemo,
      aiError,
      verification,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[credit-memo/canonical/narratives POST]", msg);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
