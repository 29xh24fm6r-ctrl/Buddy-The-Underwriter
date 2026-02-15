import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { assembleNarratives, overlayNarratives } from "@/lib/creditMemo/canonical/narrativeAssembly";

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await props.params;
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) {
      return NextResponse.json({ ok: false, error: "no_bank" }, { status: 401 });
    }
    const bankId = bankPick.bankId;

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

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
