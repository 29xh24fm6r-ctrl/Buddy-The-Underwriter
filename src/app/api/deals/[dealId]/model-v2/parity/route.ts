/**
 * Model Engine V2 — Parity Debug Endpoint
 *
 * READ-ONLY. This endpoint NEVER writes to the database.
 * It compares V1 spread output to V2 model engine output for debugging.
 *
 * Auth: requireRole(["super_admin", "bank_admin", "underwriter"])
 * Gate: USE_MODEL_ENGINE_V2 must be true
 * Guard: includeRaw requires super_admin role
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
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

// ---------------------------------------------------------------------------
// Input validation helpers (pure, no DB)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_FORMATS = new Set(["json", "markdown"]);

function validateDealId(dealId: string): string | null {
  if (!UUID_RE.test(dealId)) return "invalid_deal_id: must be UUID";
  return null;
}

function validatePeriod(period: string | null): string | null {
  if (period === null) return null;
  if (!DATE_RE.test(period)) return "invalid_period: must be YYYY-MM-DD";
  return null;
}

function validateFormat(format: string | null): string | null {
  if (format === null) return null;
  if (!VALID_FORMATS.has(format)) return `invalid_format: must be one of ${[...VALID_FORMATS].join(", ")}`;
  return null;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    // Feature flag gate
    if (!isModelEngineV2Enabled()) {
      return NextResponse.json(
        { ok: false, error: "model_engine_v2_disabled" },
        { status: 404 },
      );
    }

    await requireRole(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;

    // Input validation
    const dealIdErr = validateDealId(dealId);
    if (dealIdErr) {
      return NextResponse.json({ ok: false, error: dealIdErr }, { status: 400 });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();
    const url = new URL(req.url);

    // Parse and validate query params
    const relaxed = url.searchParams.get("relaxed") === "true";
    const includeRaw = url.searchParams.get("includeRaw") === "true";
    const periodFilter = url.searchParams.get("period");
    const format = url.searchParams.get("format");
    const thresholds = relaxed ? RELAXED_THRESHOLDS : DEFAULT_THRESHOLDS;

    const periodErr = validatePeriod(periodFilter);
    if (periodErr) {
      return NextResponse.json({ ok: false, error: periodErr }, { status: 400 });
    }

    const formatErr = validateFormat(format);
    if (formatErr) {
      return NextResponse.json({ ok: false, error: formatErr }, { status: 400 });
    }

    // includeRaw is an expensive operation — restrict to super_admin
    if (includeRaw) {
      try {
        await requireSuperAdmin();
      } catch {
        return NextResponse.json(
          { ok: false, error: "includeRaw requires super_admin role" },
          { status: 403 },
        );
      }
    }

    // Run the spec-shaped ParityReport comparison (READ-ONLY)
    const parityReport = await compareSpreadToModelV2(dealId, sb);

    // Filter to single period if requested
    if (periodFilter) {
      parityReport.periodComparisons = parityReport.periodComparisons.filter(
        (pc) => pc.periodEnd === periodFilter || pc.periodId === periodFilter,
      );
    }

    // Also run the original threshold-based comparison (READ-ONLY)
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

    // Include raw metric maps for debugging (super_admin only, checked above)
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
