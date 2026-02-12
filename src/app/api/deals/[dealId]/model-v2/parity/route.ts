import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { isModelEngineV2Enabled } from "@/lib/modelEngine";
import { compareV1toV2 } from "@/lib/modelEngine/parity/compareV1toV2";
import { compareSpreadToModelV2 } from "@/lib/modelEngine/parity/parityCompare";
import {
  extractSpreadParityMetrics,
  extractModelV2ParityMetrics,
} from "@/lib/modelEngine/parity/parityTargets";
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
    const url = new URL(req.url);

    // Query params
    const relaxed = url.searchParams.get("relaxed") === "true";
    const includeRaw = url.searchParams.get("includeRaw") === "true";
    const periodFilter = url.searchParams.get("period"); // YYYY-MM-DD
    const format = url.searchParams.get("format");
    const thresholds = relaxed ? RELAXED_THRESHOLDS : DEFAULT_THRESHOLDS;

    // Run the spec-shaped ParityReport comparison
    const parityReport = await compareSpreadToModelV2(dealId, sb);

    // Filter to single period if requested
    if (periodFilter) {
      parityReport.periodComparisons = parityReport.periodComparisons.filter(
        (pc) => pc.periodEnd === periodFilter || pc.periodId === periodFilter,
      );
    }

    // Also run the original threshold-based comparison
    const comparison = await compareV1toV2(dealId, sb, thresholds);

    // Markdown format
    if (format === "markdown") {
      const md = formatParityReport(comparison);
      return new NextResponse(md, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    // JSON response
    const response: Record<string, any> = {
      ok: true,
      // Spec-shaped ParityReport (materiality-based)
      parityReport,
      // Original comparison (threshold-based, backward compat)
      dealId: comparison.dealId,
      periods: comparison.periods,
      diffs: comparison.diffs,
      headline: comparison.headline,
      flags: comparison.flags,
      passFail: comparison.passFail,
      thresholdsUsed: comparison.thresholdsUsed,
    };

    // Include raw metric maps for debugging
    if (includeRaw) {
      const [spreadMetrics, modelMetrics] = await Promise.all([
        extractSpreadParityMetrics(dealId, sb),
        extractModelV2ParityMetrics(dealId, sb),
      ]);
      response.raw = { spreadMetrics, modelMetrics };
    }

    return NextResponse.json(response);
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/model-v2/parity]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
