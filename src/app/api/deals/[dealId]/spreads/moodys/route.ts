import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { renderMoodysSpreadWithValidation } from "@/lib/financialSpreads/moodys/renderMoodysSpread";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";
import { isModelEngineV2Enabled, buildFinancialModel } from "@/lib/modelEngine";
import { renderFromFinancialModel } from "@/lib/modelEngine/renderer/v2Adapter";
import { renderFromLegacySpread } from "@/lib/modelEngine/renderer/v1Adapter";
import { diffSpreadViewModels } from "@/lib/modelEngine/renderer/viewModelDiff";
import { writeSystemEvent } from "@/lib/aegis/writeSystemEvent";
import type { FinancialFact } from "@/lib/financialSpreads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

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

    const sb = supabaseAdmin();

    // Load all financial facts for this deal
    const { data: facts, error: factsErr } = await (sb as any)
      .from("deal_financial_facts")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .neq("fact_type", "EXTRACTION_HEARTBEAT");

    if (factsErr) {
      return NextResponse.json(
        { ok: false, error: `facts_load_failed: ${factsErr.message}` },
        { status: 500 },
      );
    }

    // Build snapshot for validation (non-fatal if it fails)
    let snapshot = null;
    try {
      snapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId: access.bankId });
    } catch {
      // Snapshot build failure is non-fatal — render without validation
    }

    // Render Moody's spread from facts with validation
    const { validation, ...rendered } = renderMoodysSpreadWithValidation({
      dealId,
      bankId: access.bankId,
      facts: (facts ?? []) as FinancialFact[],
      snapshot,
    });

    // Persist to deal_spreads (best-effort, non-blocking for response)
    const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
    (sb as any)
      .from("deal_spreads")
      .upsert(
        {
          deal_id: dealId,
          bank_id: access.bankId,
          spread_type: "MOODYS",
          spread_version: 1,
          owner_type: "DEAL",
          owner_entity_id: SENTINEL_UUID,
          status: "ready",
          inputs_hash: null,
          rendered_json: rendered,
          rendered_html: null,
          rendered_csv: null,
          error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" },
      )
      .then(() => {})
      .catch((err: any) => {
        console.warn("[moodys/route] persist failed (non-fatal)", err?.message);
      });

    // V2 Model Engine: shadow compare + return SpreadViewModel when enabled
    let viewModel = null;
    if (isModelEngineV2Enabled()) {
      try {
        const model = buildFinancialModel(dealId, (facts ?? []) as FinancialFact[]);
        viewModel = renderFromFinancialModel(model, dealId);

        // Shadow diff: compare V1 legacy vs V2 model at ViewModel level
        const v1ViewModel = renderFromLegacySpread(rendered as any, dealId);
        const diff = diffSpreadViewModels(v1ViewModel, viewModel);

        // Fire-and-forget telemetry via Aegis
        void writeSystemEvent({
          event_type: diff.summary.pass ? "success" : "warning",
          severity: diff.summary.pass ? "info" : "warning",
          source_system: "api",
          deal_id: dealId,
          bank_id: access.bankId ?? undefined,
          error_code: "MOODYS_RENDER_DIFF",
          payload: {
            materialDiffs: diff.summary.materialDiffs,
            totalCells: diff.summary.totalCells,
            matchingCells: diff.summary.matchingCells,
            maxAbsDelta: diff.summary.maxAbsDelta,
          },
        });
      } catch (e: any) {
        console.warn("[moodys/route] V2 shadow diff failed (non-fatal):", e?.message);
      }
    }

    return NextResponse.json({
      ok: true,
      dealId,
      spread: rendered,
      validation: validation ?? null,
      ...(viewModel ? { viewModel } : {}),
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/spreads/moodys]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
