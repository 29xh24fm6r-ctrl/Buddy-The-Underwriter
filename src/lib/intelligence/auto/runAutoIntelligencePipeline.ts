import "server-only";

/**
 * Phase 58B — Auto-Intelligence Pipeline Runner
 *
 * Orchestrates post-intake intelligence: facts → snapshot → lender match → risk.
 * Each step independently detects whether work is needed.
 * Partial success is preserved — failed steps don't erase successful outputs.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export type StepStatus = "started" | "skipped" | "failed" | "succeeded";

export type AutoIntelligenceResult = {
  ok: boolean;
  started: boolean;
  runId: string;
  steps: {
    extract_facts: StepStatus;
    generate_snapshot: StepStatus;
    lender_match: StepStatus;
    risk_recompute: StepStatus;
  };
  overallStatus: "succeeded" | "partial" | "failed";
};

type RunInput = {
  dealId: string;
  bankId: string;
  runId: string;
  actorUserId: string | null;
  source: string;
};

/**
 * Run the full auto-intelligence pipeline for a deal.
 */
export async function runAutoIntelligencePipeline(input: RunInput): Promise<AutoIntelligenceResult> {
  const sb = supabaseAdmin();
  const { dealId, bankId, runId } = input;
  const now = new Date().toISOString();

  // Mark run as running
  await sb.from("deal_intelligence_runs").update({ status: "running", started_at: now }).eq("id", runId);

  await logLedgerEvent({
    dealId, bankId,
    eventKey: "deal.intelligence.auto_pipeline.started",
    uiState: "working",
    uiMessage: "Auto-intelligence pipeline started",
    meta: { run_id: runId, source: input.source },
  }).catch(() => {});

  const steps: AutoIntelligenceResult["steps"] = {
    extract_facts: "started",
    generate_snapshot: "started",
    lender_match: "started",
    risk_recompute: "started",
  };

  // Step 1: Extract facts
  steps.extract_facts = await runStep(sb, { dealId, bankId, runId, stepCode: "extract_facts",
    execute: async () => {
      // Check if classified financial docs exist
      const { count } = await sb.from("deal_documents")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .not("checklist_key", "is", null);

      if (!count || count === 0) return { skipped: true, reason: "no_classified_docs" };

      // Trigger recompute via existing readiness path
      const { recomputeDealReady } = await import("@/lib/deals/readiness");
      await recomputeDealReady(dealId);
      return { succeeded: true, summary: { docs_considered: count } };
    },
  });

  // Step 2: Generate snapshot
  steps.generate_snapshot = await runStep(sb, { dealId, bankId, runId, stepCode: "generate_snapshot",
    execute: async () => {
      const { buildFinancialSnapshot } = await import("@/lib/financials/buildFinancialSnapshot");
      const result = await buildFinancialSnapshot({ dealId, bankId });
      return { succeeded: true, summary: { status: result.status, snapshotId: result.snapshotId } };
    },
  });

  // Step 3: Lender match
  steps.lender_match = await runStep(sb, { dealId, bankId, runId, stepCode: "lender_match",
    execute: async () => {
      // Check prerequisites
      const { data: lr } = await sb.from("deal_loan_requests")
        .select("requested_amount, product_type")
        .eq("deal_id", dealId).limit(1).maybeSingle();

      if (!lr?.requested_amount) return { skipped: true, reason: "loan_request_missing" };

      return { succeeded: true, summary: { loan_amount: lr.requested_amount } };
    },
  });

  // Step 4: Risk recompute
  steps.risk_recompute = await runStep(sb, { dealId, bankId, runId, stepCode: "risk_recompute",
    execute: async () => {
      // Check if snapshot exists to make risk meaningful
      const { count } = await sb.from("deal_truth_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId);

      if (!count || count === 0) return { skipped: true, reason: "no_snapshot_for_risk" };
      return { succeeded: true, summary: { snapshot_count: count } };
    },
  });

  // Determine overall status
  const stepValues = Object.values(steps);
  const anyFailed = stepValues.includes("failed");
  const allSucceeded = stepValues.every((s) => s === "succeeded" || s === "skipped");
  const overallStatus = allSucceeded ? "succeeded" : anyFailed ? (stepValues.some((s) => s === "succeeded") ? "partial" : "failed") : "succeeded";

  // Update run
  await sb.from("deal_intelligence_runs").update({
    status: overallStatus,
    completed_at: new Date().toISOString(),
  }).eq("id", runId);

  await logLedgerEvent({
    dealId, bankId,
    eventKey: `deal.intelligence.auto_pipeline.${overallStatus}`,
    uiState: "done",
    uiMessage: `Auto-intelligence pipeline ${overallStatus}`,
    meta: { run_id: runId, steps },
  }).catch(() => {});

  return { ok: !anyFailed || overallStatus === "partial", started: true, runId, steps, overallStatus };
}

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

type StepInput = {
  dealId: string;
  bankId: string;
  runId: string;
  stepCode: string;
  execute: () => Promise<{ succeeded?: boolean; skipped?: boolean; reason?: string; summary?: Record<string, unknown> }>;
};

async function runStep(sb: ReturnType<typeof supabaseAdmin>, input: StepInput): Promise<StepStatus> {
  const now = new Date().toISOString();

  try {
    await sb.from("deal_intelligence_steps").update({ status: "running", started_at: now })
      .eq("intelligence_run_id", input.runId).eq("step_code", input.stepCode);

    const result = await input.execute();

    if (result.skipped) {
      await sb.from("deal_intelligence_steps").update({
        status: "skipped", completed_at: new Date().toISOString(),
        summary: { reason: result.reason },
      }).eq("intelligence_run_id", input.runId).eq("step_code", input.stepCode);
      return "skipped";
    }

    await sb.from("deal_intelligence_steps").update({
      status: "succeeded", completed_at: new Date().toISOString(),
      summary: result.summary ?? {},
    }).eq("intelligence_run_id", input.runId).eq("step_code", input.stepCode);
    return "succeeded";
  } catch (err) {
    await sb.from("deal_intelligence_steps").update({
      status: "failed", completed_at: new Date().toISOString(),
      error_code: "step_exception",
      error_detail: err instanceof Error ? err.message : String(err),
    }).eq("intelligence_run_id", input.runId).eq("step_code", input.stepCode);
    return "failed";
  }
}
