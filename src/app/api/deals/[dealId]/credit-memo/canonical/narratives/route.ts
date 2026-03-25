import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
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
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const forceRegenerate = body?.force === true;

    // Build the deterministic memo first
    const memoResult = await buildCanonicalCreditMemo({ dealId, bankId: auth.bankId });
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
