import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
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
// GET handler — authoritative V2 underwrite endpoint
// ---------------------------------------------------------------------------

/**
 * GET /api/deals/[dealId]/underwrite
 *
 * Authoritative underwriting endpoint (V2 sole engine).
 * No V1 fallback. V2 failure propagates as 500.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    // Load inputs
    const [model, instruments, bankConfig, product] = await Promise.all([
      loadDealModel(dealId),
      loadDealInstruments(dealId),
      loadActiveBankConfig(access.bankId),
      resolveProductType(dealId),
    ]);

    // V2 pipeline — sole engine, no fallback
    const result = runFullUnderwrite({
      model,
      product,
      instruments: instruments.length > 0 ? instruments : undefined,
      bankConfig: bankConfig ?? undefined,
    });

    if (!result.diagnostics.pipelineComplete) {
      throw new Error(
        (result as { diagnostics: { reason: string } }).diagnostics.reason,
      );
    }

    const v2Result = result as UnderwriteResult;

    // Parity diagnostics (non-fatal)
    let parity: { verdict: string; warningCount: number; blockCount: number } | undefined;
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
      }
    } catch {
      // Parity evaluation failure is non-fatal
    }

    // Emit served event
    emitV2Event({
      code: V2_EVENT_CODES.MODEL_V2_PRIMARY_SERVED,
      dealId,
      bankId: access.bankId,
      payload: {
        tier: v2Result.policy.tier,
        metricsComputed: Object.keys(v2Result.snapshot.ratios).length,
      },
    });

    return NextResponse.json({
      ok: true,
      result: {
        snapshot: v2Result.snapshot,
        analysis: v2Result.analysis,
        policy: v2Result.policy,
        stress: v2Result.stress,
        pricing: v2Result.pricing,
        memo: v2Result.memo,
      },
      ...(parity ? { parity } : {}),
      diagnostics: {
        computedAt: new Date().toISOString(),
        modelPeriodCount: model.periods.length,
        instrumentCount: instruments.length,
      },
    });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/underwrite]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
