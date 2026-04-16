/**
 * POST /api/deals/[dealId]/credit-memo/generate
 *
 * Generates a credit memo using the Gemini 3 Flash provider.
 * Hard requires:
 *   1. A completed AI risk assessment (ai_risk_runs)
 *
 * Soft requires (proceeds gracefully when absent):
 *   2. A completed research mission with narrative (buddy_research_missions)
 *      If no research exists, researchNarrative is empty and memo is generated
 *      from financial facts + risk assessment alone.
 *
 * Returns the generated memo persisted to canonical_memo_narratives.
 */

import { NextResponse } from "next/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getAIProvider } from "@/lib/ai/provider";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { computeMemoInputHash } from "@/lib/creditMemo/canonical/memoProvenance";
import { fetchMemoHashInputs } from "@/lib/creditMemo/canonical/fetchMemoHashInputs";
import { loadAndEnforceResearchTrust, loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { buildResearchTrace } from "@/lib/research/memoEvidenceResolver";
import type { RiskOutput } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // ── Step 1: Fetch AI risk assessment (hard required) ──────────────────
    const { data: riskRun, error: riskErr } = await sb
      .from("ai_risk_runs")
      .select("id, grade, base_rate_bps, risk_premium_bps, result_json, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (riskErr) throw riskErr;
    if (!riskRun) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "AI risk assessment required before generating memo. Run AI Assessment first.",
        },
        { status: 400 },
      );
    }

    // ── Step 1b: Phase 79 — Trust grade enforcement (soft gate for memo) ──
    // Block memo generation when research explicitly failed.
    // Missing/absent research is allowed (memo proceeds without it).
    const trustCheck = await loadAndEnforceResearchTrust(dealId, "memo");
    if (!trustCheck.allowed) {
      return NextResponse.json(
        { ok: false, error: trustCheck.reason },
        { status: 400 },
      );
    }

    // ── Step 2: Fetch research narrative (soft — proceed if absent) ───────
    // Research is NOT a hard gate. If no completed research mission exists
    // (e.g., it was deleted, not yet run, or is still in progress), we
    // proceed with an empty research narrative. The memo will be generated
    // from financial facts and the risk assessment alone. This prevents
    // blocking memo generation when research was deliberately cleared
    // (e.g., to remove contaminated data) or simply hasn't been run yet.
    const { data: mission, error: missionErr } = await sb
      .from("buddy_research_missions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("status", "complete")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (missionErr) throw missionErr;
    // Note: mission may be null — that is expected and handled below

    let narrative: { sections: any[] } | null = null;
    if (mission) {
      const { data: narrativeData, error: narrativeErr } = await sb
        .from("buddy_research_narratives")
        .select("sections")
        .eq("mission_id", mission.id)
        .maybeSingle();

      if (narrativeErr) throw narrativeErr;
      narrative = narrativeData;
    }

    // ── Step 2b: Validation Pass gate ─────────────────────────────────────
    // Only hard-block when a report exists with gating_decision = BLOCK_GENERATION.
    // Absent report = validation has not run yet — allow generation to proceed.
    const { data: validationReport } = await sb
      .from("buddy_validation_reports")
      .select("gating_decision")
      .eq("deal_id", dealId)
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (validationReport?.gating_decision === "BLOCK_GENERATION") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Validation has flagged blocking issues. Resolve them before generating memo.",
        },
        { status: 400 },
      );
    }

    // ── Step 3: Build deal snapshot ──────────────────────────────────────
    // NOTE: deal_financial_facts uses fact_period_end, not period_end
    const [dealResult, factsResult] = await Promise.all([
      sb
        .from("deals")
        .select("id, borrower_name, loan_amount, state, borrower_id, borrowers(naics_code, naics_description, legal_name)")
        .eq("id", dealId)
        .maybeSingle(),
      sb
        .from("deal_financial_facts")
        .select("fact_key, fact_value_num, fact_period_end")
        .eq("deal_id", dealId)
        .not("fact_value_num", "is", null)
        .order("fact_period_end", { ascending: false }),
    ]);

    if (dealResult.error) throw dealResult.error;
    if (factsResult.error) throw factsResult.error;

    const deal = dealResult.data;
    const facts = factsResult.data ?? [];
    const borrower = (deal?.borrowers as any) ?? {};

    // Build research narrative text (empty string when no research exists)
    let researchNarrative = "";
    if (narrative?.sections) {
      const sections = Array.isArray(narrative.sections)
        ? narrative.sections
        : [];
      researchNarrative = sections
        .map((s: any) => {
          const title = s.title ?? "";
          const body = Array.isArray(s.sentences)
            ? s.sentences.map((sent: any) => sent.text ?? "").join(" ")
            : "";
          return `${title}\n${body}`;
        })
        .join("\n\n");
    }

    // Extract key financial facts (most recent per key)
    const factMap: Record<string, number> = {};
    for (const f of facts) {
      if (f.fact_key && f.fact_value_num != null && !(f.fact_key in factMap)) {
        factMap[f.fact_key] = f.fact_value_num;
      }
    }

    const dealSnapshot: Record<string, any> = {
      dealId,
      borrowerName: deal?.borrower_name ?? "",
      legalName: borrower.legal_name ?? deal?.borrower_name ?? "",
      loanAmount: deal?.loan_amount ?? null,
      state: deal?.state ?? "",
      naicsCode: borrower.naics_code ?? "",
      naicsDescription: borrower.naics_description ?? "",
      researchNarrative,
      revenue: factMap["TOTAL_REVENUE"] ?? factMap["GROSS_REVENUE"] ?? null,
      ebitda: factMap["EBITDA"] ?? null,
      dscr: factMap["DSCR"] ?? null,
      annualDebtService: factMap["ANNUAL_DEBT_SERVICE"] ?? null,
      noi: factMap["NOI"] ?? factMap["NET_OPERATING_INCOME"] ?? null,
      totalAssets: factMap["TOTAL_ASSETS"] ?? null,
      totalLiabilities: factMap["TOTAL_LIABILITIES"] ?? null,
      netWorth: factMap["NET_WORTH"] ?? null,
    };

    // ── Step 4: Build risk output ────────────────────────────────────────
    const riskOutput: RiskOutput = riskRun.result_json as RiskOutput;

    // ── Step 5: Generate memo ────────────────────────────────────────────
    const provider = getAIProvider();
    const memo = await provider.generateMemo({
      dealId,
      dealSnapshot,
      risk: riskOutput,
    });

    // ── Step 6: Compute provenance hash from canonical inputs ─────────────
    const hashInputs = await fetchMemoHashInputs(sb, dealId);
    const inputHash = computeMemoInputHash(hashInputs);

    // ── Step 6b: Phase 79 — Build research evidence trace + trust grade ──
    const [researchTrace, currentTrustGrade] = await Promise.all([
      buildResearchTrace(dealId),
      loadTrustGradeForDeal(dealId),
    ]);

    // ── Step 7: Persist to canonical_memo_narratives ─────────────────────
    const { error: upsertErr } = await sb
      .from("canonical_memo_narratives")
      .upsert(
        {
          deal_id: dealId,
          bank_id: bankId,
          input_hash: inputHash,
          narratives: memo as any,
          model: "gemini-3-flash-preview",
          generated_at: new Date().toISOString(),
          research_trace_json: researchTrace,
          research_trust_grade: currentTrustGrade,
        } as any,
        { onConflict: "deal_id,bank_id,input_hash" },
      );

    if (upsertErr) throw upsertErr;

    // ── Step 8: Log pipeline ledger + observability event ────────────────
    await logPipelineLedger(sb, {
      bank_id: bankId,
      deal_id: dealId,
      event_key: "credit_memo_generated",
      status: "ok",
      payload: {
        section_count: memo.sections.length,
        risk_run_id: riskRun.id,
        mission_id: mission?.id ?? null,
        has_research: !!mission,
        model: "gemini-3-flash-preview",
        input_hash: inputHash,
      },
    });

    void writeEvent({
      dealId,
      kind: "memo.generation.completed",
      scope: "memo",
      action: "generate",
      meta: {
        input_hash: inputHash,
        section_count: memo.sections.length,
        risk_run_id: riskRun.id,
        mission_id: mission?.id ?? null,
        has_research: !!mission,
        model: "gemini-3-flash-preview",
        snapshot_id: hashInputs.snapshotId,
        pricing_decision_id: hashInputs.pricingDecisionId,
        fact_count: hashInputs.factCount,
      },
    });

    return NextResponse.json({ ok: true, memo, inputHash });
  } catch (error: any) {
    rethrowNextErrors(error);

    try {
      const bankId = await getCurrentBankId().catch(() => "");
      const { dealId } = await ctx.params;
      if (bankId) {
        await logPipelineLedger(supabaseAdmin(), {
          bank_id: bankId,
          deal_id: dealId,
          event_key: "credit_memo_generation_failed",
          status: "error",
          payload: { error: error?.message ?? "unknown" },
        });
      }
      void writeEvent({
        dealId,
        kind: "memo.generation.failed",
        scope: "memo",
        action: "generate",
        meta: { error: error?.message ?? "unknown" },
      });
    } catch {
      // Best-effort ledger logging
    }

    console.error("[/api/deals/[dealId]/credit-memo/generate] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
