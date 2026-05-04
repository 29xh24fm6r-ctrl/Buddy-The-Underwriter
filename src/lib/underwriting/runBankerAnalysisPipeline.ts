/**
 * Banker E2E Analysis Pipeline (V2 — authoritative).
 *
 * One synchronous, awaited path that runs after spreads are ready and produces:
 *   model snapshot → reconciliation → risk run → memo run →
 *   deal decision → committee-ready signal
 *
 * This module is the single entry point. Every step is awaited — no
 * fire-and-forget on Vercel. If a step blocks, the function returns
 * { status: "blocked", blockers, ids }. Existing canonical writers are
 * called directly (no HTTP); the goal is to chain the pieces, not
 * re-implement them.
 *
 * Used by:
 *   - the spreads worker, after a job transitions to SUCCEEDED
 *   - POST /api/deals/[dealId]/banker-analysis/run (manual / admin)
 */

import { assertServerOnly } from "@/lib/serverOnly";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AIProvider,
  RiskOutput,
  MemoOutput,
} from "@/lib/ai/provider";
import type { DealReconciliationSummary } from "@/lib/reconciliation/types";
import type { writeEvent as WriteEventFn } from "@/lib/ledger/writeEvent";
import type { logPipelineLedger as LogPipelineLedgerFn } from "@/lib/pipeline/logPipelineLedger";

assertServerOnly();

// Heavy server-only collaborators are resolved lazily at call time so this
// module can be imported in unit tests with all dependencies injected via
// `_deps`. See bankerAnalysisGuard / runBankerAnalysisPipeline tests.
async function loadProductionDeps() {
  const [
    { supabaseAdmin },
    { computeAuthoritativeEngine },
    { reconcileDeal },
    { getAIProvider },
    { writeEvent },
    { logPipelineLedger },
  ] = await Promise.all([
    import("@/lib/supabase/admin"),
    import("@/lib/modelEngine/engineAuthority"),
    import("@/lib/reconciliation/dealReconciliator"),
    import("@/lib/ai/provider"),
    import("@/lib/ledger/writeEvent"),
    import("@/lib/pipeline/logPipelineLedger"),
  ]);
  return {
    supabaseAdmin,
    computeAuthoritativeEngine,
    reconcileDeal,
    getAIProvider,
    writeEvent,
    logPipelineLedger,
  };
}

// ─── Public types ────────────────────────────────────────────────────────────

export type BankerAnalysisReason =
  | "spreads_ready"
  | "manual_run"
  | "admin_replay"
  | "post_intake";

export type BankerAnalysisBlocker =
  | "DEAL_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "LOAN_REQUEST_INCOMPLETE"
  | "SPREADS_NOT_READY"
  | "MODEL_SNAPSHOT_FAILED"
  | "RISK_RUN_FAILED"
  | "MEMO_RUN_FAILED"
  | "DECISION_WRITE_FAILED"
  | "RECONCILIATION_CONFLICTS"
  | "RECONCILIATION_FLAGS"
  | "ALREADY_RUNNING";

export type BankerAnalysisStatus = "succeeded" | "blocked" | "failed";

export type BankerAnalysisResult = {
  status: BankerAnalysisStatus;
  reason: BankerAnalysisReason;
  blockers: BankerAnalysisBlocker[];
  ids: {
    snapshotId: string | null;
    aiRiskRunId: string | null;
    riskRunId: string | null;
    memoRunId: string | null;
    decisionId: string | null;
    reconciliationStatus: "CLEAN" | "FLAGS" | "CONFLICTS" | null;
    committeeReady: boolean;
  };
  durationMs: number;
  message?: string;
};

export type BankerAnalysisInput = {
  dealId: string;
  bankId: string;
  reason: BankerAnalysisReason;
  /** Optional: caller-provided actor ID (Clerk user, "system:spreads-worker", etc.) */
  actor?: string | null;
  /** Optional: skip the in-flight idempotency check (admin replay). */
  forceRun?: boolean;
  /**
   * Test-only: inject collaborators so the pipeline can be exercised without
   * hitting Supabase / OpenAI / Vertex. Production callers leave this
   * undefined and the real implementations are used.
   */
  _deps?: BankerAnalysisDeps;
};

export type BankerAnalysisDeps = {
  sb?: SupabaseClient;
  computeEngine?: (
    dealId: string,
    bankId: string,
  ) => Promise<{ snapshotId: string | null }>;
  reconcile?: (dealId: string) => Promise<DealReconciliationSummary>;
  provider?: AIProvider;
  writeEvent?: typeof WriteEventFn;
  logPipelineLedger?: typeof LogPipelineLedgerFn;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const IN_FLIGHT_DEDUP_WINDOW_MS = 60_000;

// Recommendation rules from risk grade. Conservative — never auto-decline.
export function recommendationFromGrade(grade: string | undefined | null):
  | "approved"
  | "conditional_approval"
  | "escalate"
  | "tabled" {
  const g = (grade ?? "").toUpperCase().trim();
  if (g.startsWith("A")) return "approved";
  if (g.startsWith("B")) return "conditional_approval";
  if (g.startsWith("C")) return "escalate";
  // D, F, anything unknown
  return "tabled";
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runBankerAnalysisPipeline(
  input: BankerAnalysisInput,
): Promise<BankerAnalysisResult> {
  const start = Date.now();
  const deps = input._deps ?? {};
  // Resolve production deps lazily (only what hasn't been injected). Tests
  // that pass a complete _deps never trigger the dynamic import, so the
  // pipeline can be exercised without server-only modules in scope.
  const needsProd =
    !deps.sb ||
    !deps.computeEngine ||
    !deps.reconcile ||
    !deps.provider ||
    !deps.writeEvent ||
    !deps.logPipelineLedger;
  const prod = needsProd ? await loadProductionDeps() : null;
  const sb = deps.sb ?? prod!.supabaseAdmin();
  const computeEngine = deps.computeEngine ?? prod!.computeAuthoritativeEngine;
  const reconcile = deps.reconcile ?? prod!.reconcileDeal;
  const provider = deps.provider ?? prod!.getAIProvider();
  const emitEvent = deps.writeEvent ?? prod!.writeEvent;
  const writeLedger = deps.logPipelineLedger ?? prod!.logPipelineLedger;
  const actor = input.actor ?? "system:banker-analysis";

  const ids: BankerAnalysisResult["ids"] = {
    snapshotId: null,
    aiRiskRunId: null,
    riskRunId: null,
    memoRunId: null,
    decisionId: null,
    reconciliationStatus: null,
    committeeReady: false,
  };

  const blocked = (
    blockers: BankerAnalysisBlocker[],
    message?: string,
  ): BankerAnalysisResult => ({
    status: "blocked",
    reason: input.reason,
    blockers,
    ids,
    durationMs: Date.now() - start,
    message,
  });

  // 1. Validate deal + bank ──────────────────────────────────────────────
  const dealRow = await loadDeal(sb, input.dealId);
  if (!dealRow) return blocked(["DEAL_NOT_FOUND"]);
  if (dealRow.bank_id !== input.bankId) return blocked(["TENANT_MISMATCH"]);

  // 2. Loan request gate ─────────────────────────────────────────────────
  const hasLoanReq = await hasCompleteLoanRequest(sb, input.dealId, dealRow.loan_amount);
  if (!hasLoanReq) {
    await emitEvent({
      dealId: input.dealId,
      kind: "banker_analysis.blocked",
      scope: "underwriting",
      action: "run_pipeline",
      meta: { blocker: "LOAN_REQUEST_INCOMPLETE", reason: input.reason },
    });
    return blocked(
      ["LOAN_REQUEST_INCOMPLETE"],
      "Loan request is missing requested_amount and deals.loan_amount is null.",
    );
  }

  // 3. Spread readiness gate ─────────────────────────────────────────────
  const spreadsReady = await spreadsAreReady(sb, input.dealId, input.bankId);
  if (!spreadsReady) {
    await emitEvent({
      dealId: input.dealId,
      kind: "banker_analysis.blocked",
      scope: "underwriting",
      action: "run_pipeline",
      meta: { blocker: "SPREADS_NOT_READY", reason: input.reason },
    });
    return blocked(
      ["SPREADS_NOT_READY"],
      "No deal_spreads row with status=ready exists for this deal/bank.",
    );
  }

  // 4. Idempotency: don't double-run for the same deal in flight ─────────
  if (!input.forceRun) {
    const inFlight = await isAnotherRunInFlight(sb, input.dealId);
    if (inFlight) {
      return blocked(
        ["ALREADY_RUNNING"],
        "Another banker analysis run is in flight for this deal.",
      );
    }
  }

  // 5. Mark a risk_runs row as 'running' — acts as the in-flight marker.
  //    Must succeed before we proceed; if the insert fails we abort cleanly.
  const runningRiskRunId = await openRiskRunMarker(sb, input.dealId, input.reason);

  try {
    // 6. Compute & persist Model V2 snapshot ──────────────────────────────
    let snapshotId: string | null = null;
    try {
      const auth = await computeEngine(input.dealId, input.bankId);
      snapshotId = auth.snapshotId;
    } catch (err) {
      await failRiskRunMarker(sb, runningRiskRunId, `model_snapshot_failed: ${err instanceof Error ? err.message : "unknown"}`);
      return blocked(["MODEL_SNAPSHOT_FAILED"]);
    }
    if (!snapshotId) {
      await failRiskRunMarker(sb, runningRiskRunId, "model_snapshot_returned_null");
      return blocked(["MODEL_SNAPSHOT_FAILED"]);
    }
    ids.snapshotId = snapshotId;

    // 7. Reconciliation ────────────────────────────────────────────────────
    //    reconcileDeal persists to deal_reconciliation_results and never
    //    throws. We capture the overall_status for the gate below.
    const reconSummary = await reconcile(input.dealId);
    ids.reconciliationStatus = reconSummary.overallStatus;

    // 8. Risk run ─────────────────────────────────────────────────────────
    const dealSnapshot = await buildDealSnapshotForAi(sb, input.dealId, input.bankId);
    let riskOutput: RiskOutput;
    try {
      riskOutput = await provider.generateRisk({
        dealId: input.dealId,
        dealSnapshot,
        evidenceIndex: dealSnapshot.evidenceIndex ?? [],
      });
    } catch (err) {
      await failRiskRunMarker(sb, runningRiskRunId, `risk_generation_failed: ${err instanceof Error ? err.message : "unknown"}`);
      return blocked(["RISK_RUN_FAILED"]);
    }

    // 8a. Persist to ai_risk_runs (existing schema, read by credit-memo route)
    const aiRiskRunId = await insertAiRiskRun(sb, input.dealId, input.bankId, riskOutput);
    ids.aiRiskRunId = aiRiskRunId;

    // 8b. Mark our risk_runs marker as completed (so memo_runs.risk_run_id FK works)
    await completeRiskRunMarker(sb, runningRiskRunId, riskOutput);
    ids.riskRunId = runningRiskRunId;

    // 9. Memo run ─────────────────────────────────────────────────────────
    const memoRunId = await insertMemoRunRunning(sb, input.dealId, runningRiskRunId);

    let memoOutput: MemoOutput;
    try {
      memoOutput = await provider.generateMemo({
        dealId: input.dealId,
        dealSnapshot,
        risk: riskOutput,
      });
    } catch (err) {
      await failMemoRunMarker(sb, memoRunId, `memo_generation_failed: ${err instanceof Error ? err.message : "unknown"}`);
      return blocked(["MEMO_RUN_FAILED"]);
    }

    await completeMemoRunMarker(sb, memoRunId);
    await insertMemoSections(sb, memoRunId, memoOutput);
    ids.memoRunId = memoRunId;

    // 10. Deal decision (system recommendation) ──────────────────────────
    const recommended = recommendationFromGrade(riskOutput.grade);
    const decisionId = await insertSystemDecision(sb, {
      dealId: input.dealId,
      bankId: input.bankId,
      decision: recommended,
      decidedBy: actor,
      reconciliationStatus: ids.reconciliationStatus,
      memoRunId,
      aiRiskRunId,
      snapshotId,
      reason: input.reason,
    });
    ids.decisionId = decisionId;

    // 11. Committee-ready gate ────────────────────────────────────────────
    //    CLEAN + non-tabled recommendation → flip deal_credit_memo_status to
    //    'ready_for_committee'. FLAGS / CONFLICTS keep the previous state and
    //    return a non-fatal blocker so callers can surface the reason.
    const reconBlockers: BankerAnalysisBlocker[] = [];
    if (ids.reconciliationStatus === "CONFLICTS") {
      reconBlockers.push("RECONCILIATION_CONFLICTS");
    } else if (ids.reconciliationStatus === "FLAGS") {
      reconBlockers.push("RECONCILIATION_FLAGS");
    }

    const committeeEligible =
      reconBlockers.length === 0 && recommended !== "tabled";

    if (committeeEligible) {
      await upsertCommitteeReadySignal(sb, input.dealId, memoRunId, actor);
      ids.committeeReady = true;
    }

    // 12. Pipeline ledger event (awaited — no fire-and-forget) ────────────
    await writeLedger(sb, {
      bank_id: input.bankId,
      deal_id: input.dealId,
      event_key: "banker_analysis_completed",
      status: "ok",
      payload: {
        reason: input.reason,
        snapshot_id: snapshotId,
        ai_risk_run_id: aiRiskRunId,
        risk_run_id: runningRiskRunId,
        memo_run_id: memoRunId,
        decision_id: decisionId,
        recommendation: recommended,
        reconciliation_status: ids.reconciliationStatus,
        committee_ready: ids.committeeReady,
        recon_blockers: reconBlockers,
      },
    });

    await emitEvent({
      dealId: input.dealId,
      kind: "banker_analysis.completed",
      scope: "underwriting",
      action: "run_pipeline",
      meta: {
        reason: input.reason,
        recommendation: recommended,
        reconciliation_status: ids.reconciliationStatus,
        committee_ready: ids.committeeReady,
        snapshot_id: snapshotId,
      },
    });

    return {
      status: reconBlockers.length === 0 ? "succeeded" : "blocked",
      reason: input.reason,
      blockers: reconBlockers,
      ids,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    // Top-level catch — make sure the running marker doesn't get orphaned.
    await failRiskRunMarker(
      sb,
      runningRiskRunId,
      `unexpected: ${err instanceof Error ? err.message : "unknown"}`,
    );
    await emitEvent({
      dealId: input.dealId,
      kind: "banker_analysis.failed",
      scope: "underwriting",
      action: "run_pipeline",
      meta: {
        reason: input.reason,
        error: err instanceof Error ? err.message.slice(0, 500) : "unknown",
      },
    });
    return {
      status: "failed",
      reason: input.reason,
      blockers: [],
      ids,
      durationMs: Date.now() - start,
      message: err instanceof Error ? err.message : "unknown_error",
    };
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function loadDeal(
  sb: SupabaseClient,
  dealId: string,
): Promise<{ id: string; bank_id: string; loan_amount: number | null } | null> {
  const { data } = await sb
    .from("deals")
    .select("id, bank_id, loan_amount")
    .eq("id", dealId)
    .maybeSingle();
  return (data as any) ?? null;
}

async function hasCompleteLoanRequest(
  sb: SupabaseClient,
  dealId: string,
  dealLoanAmount: number | null,
): Promise<boolean> {
  if (typeof dealLoanAmount === "number" && dealLoanAmount > 0) return true;
  const { data } = await sb
    .from("deal_loan_requests")
    .select("requested_amount")
    .eq("deal_id", dealId)
    .order("request_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const requested = (data as any)?.requested_amount;
  return typeof requested === "number" && requested > 0;
}

async function spreadsAreReady(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("deal_spreads")
    .select("id")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("status", "ready")
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function isAnotherRunInFlight(
  sb: SupabaseClient,
  dealId: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - IN_FLIGHT_DEDUP_WINDOW_MS).toISOString();
  const { data } = await sb
    .from("risk_runs")
    .select("id")
    .eq("deal_id", dealId)
    .eq("status", "running")
    .gte("created_at", cutoff)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function openRiskRunMarker(
  sb: SupabaseClient,
  dealId: string,
  reason: BankerAnalysisReason,
): Promise<string> {
  const { data, error } = await sb
    .from("risk_runs")
    .insert({
      deal_id: dealId,
      status: "running",
      model_name: "banker_analysis_pipeline",
      model_version: "v2",
      inputs: { reason },
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`open_risk_run_marker_failed: ${error?.message ?? "unknown"}`);
  }
  return (data as any).id as string;
}

async function completeRiskRunMarker(
  sb: SupabaseClient,
  riskRunId: string,
  riskOutput: RiskOutput,
): Promise<void> {
  await sb
    .from("risk_runs")
    .update({
      status: "completed",
      outputs: riskOutput as any,
    })
    .eq("id", riskRunId);
}

async function failRiskRunMarker(
  sb: SupabaseClient,
  riskRunId: string,
  errorMsg: string,
): Promise<void> {
  await sb
    .from("risk_runs")
    .update({
      status: "failed",
      error: errorMsg.slice(0, 500),
    })
    .eq("id", riskRunId);
}

async function insertAiRiskRun(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
  riskOutput: RiskOutput,
): Promise<string | null> {
  const { data, error } = await sb
    .from("ai_risk_runs")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      grade: riskOutput.grade,
      base_rate_bps: riskOutput.baseRateBps,
      risk_premium_bps: riskOutput.riskPremiumBps,
      result_json: riskOutput as any,
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[bankerAnalysis] ai_risk_runs insert failed (non-fatal):", error.message);
    return null;
  }
  return (data as any)?.id ?? null;
}

async function insertMemoRunRunning(
  sb: SupabaseClient,
  dealId: string,
  riskRunId: string,
): Promise<string> {
  const { data, error } = await sb
    .from("memo_runs")
    .insert({
      deal_id: dealId,
      risk_run_id: riskRunId,
      status: "running",
      model_name: "banker_analysis_pipeline",
      model_version: "v2",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`memo_run_insert_failed: ${error?.message ?? "unknown"}`);
  }
  return (data as any).id as string;
}

async function completeMemoRunMarker(
  sb: SupabaseClient,
  memoRunId: string,
): Promise<void> {
  await sb
    .from("memo_runs")
    .update({ status: "completed" })
    .eq("id", memoRunId);
}

async function failMemoRunMarker(
  sb: SupabaseClient,
  memoRunId: string,
  errorMsg: string,
): Promise<void> {
  await sb
    .from("memo_runs")
    .update({ status: "failed", error: errorMsg.slice(0, 500) })
    .eq("id", memoRunId);
}

async function insertMemoSections(
  sb: SupabaseClient,
  memoRunId: string,
  memo: MemoOutput,
): Promise<void> {
  if (!memo.sections || memo.sections.length === 0) return;
  const rows = memo.sections.map((s) => ({
    memo_run_id: memoRunId,
    section_key: s.sectionKey,
    title: s.title,
    content: s.content,
    citations: (s.citations ?? []) as any,
  }));
  const { error } = await sb.from("memo_sections").insert(rows);
  if (error) {
    console.warn("[bankerAnalysis] memo_sections insert failed (non-fatal):", error.message);
  }
}

async function insertSystemDecision(
  sb: SupabaseClient,
  args: {
    dealId: string;
    bankId: string;
    decision: "approved" | "conditional_approval" | "escalate" | "tabled";
    decidedBy: string;
    reconciliationStatus: "CLEAN" | "FLAGS" | "CONFLICTS" | null;
    memoRunId: string;
    aiRiskRunId: string | null;
    snapshotId: string;
    reason: BankerAnalysisReason;
  },
): Promise<string | null> {
  const { data, error } = await sb
    .from("deal_decisions")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      decision: args.decision,
      decided_by: args.decidedBy,
      reconciliation_status: args.reconciliationStatus,
      evidence: {
        kind: "system_recommendation",
        memo_run_id: args.memoRunId,
        ai_risk_run_id: args.aiRiskRunId,
        snapshot_id: args.snapshotId,
        reason: args.reason,
      },
      notes: `System recommendation from banker analysis pipeline (${args.reason}).`,
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[bankerAnalysis] deal_decisions insert failed (non-fatal):", error.message);
    return null;
  }
  return (data as any)?.id ?? null;
}

async function upsertCommitteeReadySignal(
  sb: SupabaseClient,
  dealId: string,
  memoRunId: string,
  actor: string,
): Promise<void> {
  // deal_credit_memo_status uses deal_id as primary key.
  const { error } = await sb
    .from("deal_credit_memo_status")
    .upsert(
      {
        deal_id: dealId,
        current_status: "ready_for_committee",
        active_memo_snapshot_id: memoRunId,
        updated_at: new Date().toISOString(),
        updated_by: actor,
      },
      { onConflict: "deal_id" },
    );
  if (error) {
    console.warn("[bankerAnalysis] committee-ready upsert failed (non-fatal):", error.message);
  }
}

async function buildDealSnapshotForAi(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<Record<string, any>> {
  const [dealRes, loanReqRes, factsRes, docsRes] = await Promise.all([
    sb
      .from("deals")
      .select("entity_type, borrower_id, loan_amount, borrower_name, state")
      .eq("id", dealId)
      .maybeSingle(),
    sb
      .from("deal_loan_requests")
      .select("loan_purpose, purpose, requested_amount, product_type")
      .eq("deal_id", dealId)
      .order("request_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, fact_period_end")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected"),
    sb
      .from("deal_documents")
      .select("id, document_type, original_filename")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .limit(50),
  ]);

  const deal = (dealRes.data as any) ?? {};
  const loanReq = (loanReqRes.data as any) ?? {};

  let borrowerName: string | null = deal.borrower_name ?? null;
  let naicsCode: string | null = null;
  if (deal.borrower_id) {
    const { data: bRow } = await sb
      .from("borrowers")
      .select("legal_name, naics_code")
      .eq("id", deal.borrower_id)
      .maybeSingle();
    borrowerName = (bRow as any)?.legal_name ?? borrowerName;
    naicsCode = (bRow as any)?.naics_code ?? null;
  }

  const facts: Record<string, number | null> = {};
  const yearsSet = new Set<number>();
  for (const row of (factsRes.data ?? []) as any[]) {
    if (!row.fact_period_end || row.fact_value_num == null) continue;
    const year = new Date(row.fact_period_end).getFullYear();
    if (year < 2000 || year > 2100) continue;
    if (!String(row.fact_key).startsWith("PFS_")) yearsSet.add(year);
    facts[`${row.fact_key}_${year}`] = row.fact_value_num;
  }
  const years = Array.from(yearsSet).sort((a, b) => a - b);
  const latestYear = years[years.length - 1] ?? null;

  const evidenceIndex = ((docsRes.data ?? []) as any[]).map((d) => ({
    docId: d.id,
    label: d.document_type ?? d.original_filename ?? d.id,
    kind: "pdf" as const,
  }));

  return {
    dealId,
    borrowerName: borrowerName ?? "Unknown Borrower",
    entityType: deal.entity_type ?? null,
    state: deal.state ?? null,
    naicsCode,
    loanAmount: loanReq.requested_amount ?? deal.loan_amount ?? null,
    loanPurpose: loanReq.loan_purpose ?? loanReq.purpose ?? null,
    productType: loanReq.product_type ?? null,
    yearsAvailable: years,
    latestYear,
    grossReceipts: latestYear
      ? facts[`GROSS_RECEIPTS_${latestYear}`] ?? facts[`TOTAL_REVENUE_${latestYear}`] ?? null
      : null,
    ebitda: latestYear ? facts[`EBITDA_${latestYear}`] ?? null : null,
    netIncome: latestYear
      ? facts[`NET_INCOME_${latestYear}`] ?? facts[`ORDINARY_BUSINESS_INCOME_${latestYear}`] ?? null
      : null,
    totalAssets: latestYear ? facts[`TOTAL_ASSETS_${latestYear}`] ?? null : null,
    totalLiabilities: latestYear ? facts[`TOTAL_LIABILITIES_${latestYear}`] ?? null : null,
    revenueTrend: years.reduce<Record<string, number | null>>((acc, y) => {
      acc[String(y)] =
        facts[`GROSS_RECEIPTS_${y}`] ?? facts[`TOTAL_REVENUE_${y}`] ?? null;
      return acc;
    }, {}),
    evidenceIndex,
  };
}
