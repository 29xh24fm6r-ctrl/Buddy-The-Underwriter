import "server-only";

/**
 * Phase 58B — Enqueue Auto-Intelligence Run
 *
 * Creates an intelligence run record with seeded steps.
 * Idempotent: blocks duplicate active runs for the same deal.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

type EnqueueInput = {
  dealId: string;
  bankId: string;
  source: "intake_confirm" | "processing_complete" | "manual_retry" | "system_repair";
  createdBy: string | null;
};

type EnqueueResult = {
  ok: true;
  runId: string;
  alreadyActive: false;
} | {
  ok: true;
  runId: string;
  alreadyActive: true;
} | {
  ok: false;
  error: string;
};

const STEP_CODES = ["extract_facts", "generate_snapshot", "lender_match", "risk_recompute"] as const;

/**
 * Enqueue an auto-intelligence run. Idempotent — returns existing active run if one exists.
 */
export async function enqueueAutoIntelligenceRun(input: EnqueueInput): Promise<EnqueueResult> {
  const sb = supabaseAdmin();

  try {
    // Check for existing active run
    const { data: existing } = await sb
      .from("deal_intelligence_runs")
      .select("id, status")
      .eq("deal_id", input.dealId)
      .in("status", ["queued", "running"])
      .maybeSingle();

    if (existing) {
      return { ok: true, runId: existing.id, alreadyActive: true };
    }

    // Create new run
    const { data: run, error: runErr } = await sb
      .from("deal_intelligence_runs")
      .insert({
        deal_id: input.dealId,
        bank_id: input.bankId,
        status: "queued",
        source: input.source,
        created_by: input.createdBy,
      })
      .select("id")
      .single();

    if (runErr || !run) throw new Error(runErr?.message ?? "Run insert failed");

    // Seed step rows
    const steps = STEP_CODES.map((code) => ({
      intelligence_run_id: run.id,
      deal_id: input.dealId,
      step_code: code,
      status: "queued",
    }));

    await sb.from("deal_intelligence_steps").insert(steps);

    // Audit
    await logLedgerEvent({
      dealId: input.dealId,
      bankId: input.bankId,
      eventKey: "deal.intelligence.auto_pipeline.requested",
      uiState: "working",
      uiMessage: "Auto-intelligence pipeline requested",
      meta: { run_id: run.id, source: input.source, actor: input.createdBy },
    }).catch(() => {});

    return { ok: true, runId: run.id, alreadyActive: false };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
