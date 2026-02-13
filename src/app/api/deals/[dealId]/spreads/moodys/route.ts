import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { renderMoodysSpreadWithValidation } from "@/lib/financialSpreads/moodys/renderMoodysSpread";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";
import { selectModelEngineMode, buildFinancialModel, isV1RendererDisabled } from "@/lib/modelEngine";
import { renderFromFinancialModel } from "@/lib/modelEngine/renderer/v2Adapter";
import { renderFromLegacySpread } from "@/lib/modelEngine/renderer/v1Adapter";
import { diffSpreadViewModels } from "@/lib/modelEngine/renderer/viewModelDiff";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";
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

    // V1 renderer guard (Phase 11): when disabled, only v2_primary is allowed
    const modeResult = selectModelEngineMode({ dealId, bankId: access.bankId });
    if (isV1RendererDisabled() && modeResult.mode !== "v2_primary") {
      emitV2Event({
        code: V2_EVENT_CODES.MODEL_V1_RENDER_ATTEMPT_BLOCKED,
        dealId,
        bankId: access.bankId,
        payload: { surface: "moodys", resolvedMode: modeResult.mode },
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
          error_code: null,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" },
      )
      .then(() => {})
      .catch((err: any) => {
        console.warn("[moodys/route] persist failed (non-fatal)", err?.message);
      });

    // V2 Model Engine: mode-aware compute (modeResult computed above, before V1 guard)
    const v2Enabled = modeResult.mode !== "v1";

    let viewModel = null;
    if (v2Enabled) {
      try {
        const model = buildFinancialModel(dealId, (facts ?? []) as FinancialFact[]);
        viewModel = renderFromFinancialModel(model, dealId);

        // Shadow diff: compare V1 legacy vs V2 model at ViewModel level
        const v1ViewModel = renderFromLegacySpread(rendered as any, dealId);
        const diff = diffSpreadViewModels(v1ViewModel, viewModel);

        // Fire-and-forget telemetry via Aegis
        emitV2Event({
          code: V2_EVENT_CODES.MOODYS_RENDER_DIFF,
          dealId,
          bankId: access.bankId,
          payload: {
            mode: modeResult.mode,
            materialDiffs: diff.summary.materialDiffs,
            totalCells: diff.summary.totalCells,
            matchingCells: diff.summary.matchingCells,
            maxAbsDelta: diff.summary.maxAbsDelta,
          },
        });

        // Fire-and-forget snapshot persist (same logic as preview route)
        void import("@/lib/modelEngine/services/persistModelV2SnapshotFromDeal").then(
          ({ persistModelV2SnapshotFromDeal }) =>
            persistModelV2SnapshotFromDeal({ dealId, bankId: access.bankId, model }),
        ).catch((e) => {
          console.warn("[moodys] snapshot persist failed (non-fatal):", e);
        });

        // v2_primary: emit served event
        if (modeResult.mode === "v2_primary") {
          emitV2Event({
            code: V2_EVENT_CODES.MODEL_V2_PRIMARY_SERVED,
            dealId,
            bankId: access.bankId,
            payload: {
              surface: "moodys",
              sectionCount: viewModel.sections.length,
            },
          });
        }
      } catch (e: any) {
        console.warn("[moodys/route] V2 compute failed (non-fatal):", e?.message);

        // v2_primary: emit fallback event
        if (modeResult.mode === "v2_primary") {
          emitV2Event({
            code: V2_EVENT_CODES.MODEL_V2_FALLBACK_TO_V1,
            dealId,
            bankId: access.bankId,
            payload: { surface: "moodys", reason: e?.message ?? "unknown" },
          });
        }
      }
    }

    // Shadow metadata: minimal breadcrumb for ops (no sensitive data)
    const shadow = v2Enabled
      ? { enabled: true, mode: modeResult.mode, snapshotPersistAttempted: viewModel !== null }
      : undefined;

    return NextResponse.json({
      ok: true,
      dealId,
      spread: rendered,
      validation: validation ?? null,
      ...(viewModel ? { viewModel } : {}),
      ...(shadow ? { shadow } : {}),
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/spreads/moodys]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
