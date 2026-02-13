import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { selectModelEngineMode, isV1RendererDisabled } from "@/lib/modelEngine/modeSelector";
import { runFullUnderwrite } from "@/lib/underwritingEngine";
import { loadDealModel } from "@/lib/underwritingEngine/loaders/loadDealModel";
import { loadDealInstruments } from "@/lib/underwritingEngine/loaders/loadDealInstruments";
import { loadActiveBankConfig } from "@/lib/configEngine";
import {
  buildParityReport,
  extractSpreadParityMetricsFromData,
  extractModelV2ParityMetricsFromModel,
  evaluateParityGate,
} from "@/lib/modelEngine/parity";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";
import type { ProductType } from "@/lib/creditLenses/types";
import type { UnderwriteResult } from "@/lib/underwritingEngine/types";
import type { V1SpreadData } from "@/lib/modelEngine/parity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// Product type resolution (shared with run/route.ts pattern)
// ---------------------------------------------------------------------------

const PRODUCT_TYPE_MAP: Record<string, ProductType> = {
  SBA: "SBA",
  "SBA 7(a)": "SBA",
  "SBA 504": "SBA",
  LOC: "LOC",
  "LINE OF CREDIT": "LOC",
  EQUIPMENT: "EQUIPMENT",
  ACQUISITION: "ACQUISITION",
  CRE: "CRE",
  "COMMERCIAL REAL ESTATE": "CRE",
  CONVENTIONAL: "CRE",
};

async function resolveProductType(dealId: string): Promise<ProductType> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("deal_loan_requests")
    .select("product_type")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const raw = (data?.product_type ?? "SBA").toUpperCase();
  return PRODUCT_TYPE_MAP[raw] ?? "SBA";
}

// ---------------------------------------------------------------------------
// GET handler — canonical V2 underwrite endpoint
// ---------------------------------------------------------------------------

/**
 * GET /api/deals/[dealId]/underwrite
 *
 * Canonical endpoint for V2 underwriting outputs.
 * Returns full pipeline results + parity status + fallback info.
 *
 * Behavior:
 * - v1 mode: returns { mode: "v1", result: null }
 * - v2_shadow: runs pipeline, returns results for observation
 * - v2_primary: runs pipeline as authoritative, with fallback + parity gate
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    // Mode selection (context-aware)
    const modeResult = selectModelEngineMode({
      dealId,
      bankId: access.bankId,
    });

    // V1 renderer guard (Phase 11): when disabled, only v2_primary is allowed
    if (isV1RendererDisabled() && modeResult.mode !== "v2_primary") {
      emitV2Event({
        code: V2_EVENT_CODES.MODEL_V1_RENDER_ATTEMPT_BLOCKED,
        dealId,
        bankId: access.bankId,
        payload: { surface: "underwrite", resolvedMode: modeResult.mode },
      });
      return NextResponse.json(
        {
          ok: false,
          error_code: "V1_RENDERER_DISABLED",
          message: "V1 rendering disabled; use V2 primary.",
          resolvedMode: modeResult.mode,
        },
        { status: 409 },
      );
    }

    // v1 mode: no V2 compute
    if (modeResult.mode === "v1") {
      return NextResponse.json({
        ok: true,
        mode: "v1",
        modeReason: modeResult.reason,
        primaryEngine: "v1",
        fallbackUsed: false,
        result: null,
        diagnostics: {
          computedAt: new Date().toISOString(),
          modelPeriodCount: 0,
          instrumentCount: 0,
        },
      });
    }

    // Load inputs (v2_shadow or v2_primary)
    const [model, instruments, bankConfig, product] = await Promise.all([
      loadDealModel(dealId),
      loadDealInstruments(dealId),
      loadActiveBankConfig(access.bankId),
      resolveProductType(dealId),
    ]);

    // Attempt V2 pipeline
    let v2Result: UnderwriteResult | null = null;
    let fallbackUsed = false;
    let fallbackReason: string | undefined;

    try {
      const result = runFullUnderwrite({
        model,
        product,
        instruments: instruments.length > 0 ? instruments : undefined,
        bankConfig: bankConfig ?? undefined,
      });

      if (result.diagnostics.pipelineComplete) {
        v2Result = result as UnderwriteResult;
      } else {
        throw new Error(
          (result as { diagnostics: { reason: string } }).diagnostics.reason,
        );
      }
    } catch (e: any) {
      // V2 hard failure
      emitV2Event({
        code: V2_EVENT_CODES.MODEL_V2_HARD_FAILURE,
        dealId,
        bankId: access.bankId,
        payload: { error: e?.message ?? "unknown" },
      });

      if (modeResult.mode === "v2_primary" && process.env.V2_FALLBACK_TO_V1 !== "false") {
        fallbackUsed = true;
        fallbackReason = e?.message ?? "v2_pipeline_failed";

        emitV2Event({
          code: V2_EVENT_CODES.MODEL_V2_FALLBACK_TO_V1,
          dealId,
          bankId: access.bankId,
          payload: { reason: fallbackReason },
        });
      }
    }

    // Parity comparison (v2_primary only, and only if V2 succeeded)
    let parity: { verdict: string; warningCount: number; blockCount: number } | undefined;

    if (modeResult.mode === "v2_primary" && v2Result) {
      try {
        const sb = supabaseAdmin();
        const { data: v1Spreads } = await (sb as any)
          .from("deal_spreads")
          .select("spread_type, rendered_json")
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId)
          .in("spread_type", ["T12", "BALANCE_SHEET"]);

        const v1SpreadData: V1SpreadData[] = (v1Spreads ?? []).map((row: any) => ({
          spreadType: row.spread_type,
          periods: row.rendered_json?.columnsV2 ?? [],
          rows: row.rendered_json?.rows ?? [],
        }));

        const spreadMetrics = extractSpreadParityMetricsFromData(v1SpreadData);
        const modelMetrics = extractModelV2ParityMetricsFromModel(model);
        const report = buildParityReport(dealId, spreadMetrics, modelMetrics);
        const gateResult = evaluateParityGate(report);

        parity = {
          verdict: gateResult.verdict,
          warningCount: gateResult.warnings.length,
          blockCount: gateResult.blocks.length,
        };

        if (gateResult.verdict === "WARN") {
          emitV2Event({
            code: V2_EVENT_CODES.MODEL_V2_PARITY_WARN,
            dealId,
            bankId: access.bankId,
            payload: { warningCount: gateResult.warnings.length },
          });
        }

        if (gateResult.verdict === "BLOCK") {
          emitV2Event({
            code: V2_EVENT_CODES.MODEL_V2_PARITY_BLOCK,
            dealId,
            bankId: access.bankId,
            payload: { blockCount: gateResult.blocks.length },
          });

          // In block mode, fall back to V1
          fallbackUsed = true;
          fallbackReason = "parity_gate_block";
          v2Result = null;
        }
      } catch {
        // Parity evaluation failure is non-fatal
      }
    }

    // Emit primary served event when V2 result is returned
    if (v2Result) {
      emitV2Event({
        code: V2_EVENT_CODES.MODEL_V2_PRIMARY_SERVED,
        dealId,
        bankId: access.bankId,
        payload: {
          mode: modeResult.mode,
          tier: v2Result.policy.tier,
          metricsComputed: Object.keys(v2Result.snapshot.ratios).length,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      mode: modeResult.mode,
      modeReason: modeResult.reason,
      primaryEngine: fallbackUsed ? "v1" : "v2",
      fallbackUsed,
      ...(fallbackReason ? { fallbackReason } : {}),
      result: v2Result
        ? {
            snapshot: v2Result.snapshot,
            analysis: v2Result.analysis,
            policy: v2Result.policy,
            stress: v2Result.stress,
            pricing: v2Result.pricing,
            memo: v2Result.memo,
          }
        : null,
      ...(parity ? { parity } : {}),
      diagnostics: {
        computedAt: new Date().toISOString(),
        modelPeriodCount: model.periods.length,
        instrumentCount: instruments.length,
      },
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/underwrite]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
