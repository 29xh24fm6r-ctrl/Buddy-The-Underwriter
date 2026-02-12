import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { isModelEngineV2Enabled } from "@/lib/modelEngine";
import { compareV1toV2 } from "@/lib/modelEngine/parity/compareV1toV2";
import { formatParityReport } from "@/lib/modelEngine/parity/parityReport";
import { DEFAULT_THRESHOLDS, RELAXED_THRESHOLDS } from "@/lib/modelEngine/parity/thresholds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    if (!isModelEngineV2Enabled()) {
      return NextResponse.json(
        { ok: false, error: "model_engine_v2_disabled" },
        { status: 404 },
      );
    }

    await requireRole(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    // Optional: ?relaxed=true for $1 rounding tolerance
    const url = new URL(req.url);
    const thresholds = url.searchParams.get("relaxed") === "true"
      ? RELAXED_THRESHOLDS
      : DEFAULT_THRESHOLDS;

    // Run parity comparison (read-only, no persist)
    const comparison = await compareV1toV2(dealId, sb, thresholds);

    // Optional: ?format=markdown returns human-readable report
    if (url.searchParams.get("format") === "markdown") {
      const md = formatParityReport(comparison);
      return new NextResponse(md, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    return NextResponse.json({
      ok: true,
      dealId: comparison.dealId,
      periods: comparison.periods,
      diffs: comparison.diffs,
      headline: comparison.headline,
      flags: comparison.flags,
      passFail: comparison.passFail,
      thresholdsUsed: comparison.thresholdsUsed,
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/model-v2/parity]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
