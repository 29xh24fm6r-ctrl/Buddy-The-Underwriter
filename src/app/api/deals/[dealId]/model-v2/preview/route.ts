import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import {
  buildFinancialModel,
  computeCapitalModel,
} from "@/lib/modelEngine";
import { persistModelV2SnapshotFromDeal } from "@/lib/modelEngine/services/persistModelV2SnapshotFromDeal";
import type { FactInput, ModelPreviewResult } from "@/lib/modelEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

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

    const sb = supabaseAdmin();

    // 1. Load all financial facts for this deal
    const { data: rawFacts, error: factsErr } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_type, fact_key, fact_value_num, fact_period_end, confidence")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId);

    if (factsErr) {
      return NextResponse.json(
        { ok: false, error: `facts_load_failed: ${factsErr.message}` },
        { status: 500 },
      );
    }

    const facts: FactInput[] = (rawFacts ?? []).map((f: any) => ({
      fact_type: f.fact_type,
      fact_key: f.fact_key,
      fact_value_num: f.fact_value_num !== null ? Number(f.fact_value_num) : null,
      fact_period_end: f.fact_period_end,
      confidence: f.confidence !== null ? Number(f.confidence) : null,
    }));

    // 2. Build financial model
    const financialModel = buildFinancialModel(dealId, facts);

    // 3. Compute metrics + persist snapshot via shared service
    const snapshotResult = await persistModelV2SnapshotFromDeal({
      dealId,
      bankId: access.bankId,
      model: financialModel,
      engineSource: "authoritative",
    });

    const computedMetrics = snapshotResult?.computedMetrics ?? {};
    const riskFlags = snapshotResult?.riskFlags ?? [];
    const snapshotId = snapshotResult?.snapshotId ?? null;

    // 4. Capital model
    const capitalModel = computeCapitalModel(financialModel);

    const result: ModelPreviewResult = {
      financialModel,
      computedMetrics,
      riskFlags,
      capitalModel,
      meta: {
        modelVersion: "v1",
        metricRegistryHash: "",
        financialModelHash: "",
        periodCount: financialModel.periods.length,
        computedAt: new Date().toISOString(),
      },
    };

    return NextResponse.json({
      ok: true,
      ...result,
      ...(snapshotId ? { snapshotId } : {}),
    });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/model-v2/preview]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
