/**
 * SBA God Mode: Autopilot Orchestrator (Dual-Mode)
 * 
 * The "Make Loan Package Ready" button's brain.
 * Runs all 9 stages deterministically, resumably, and idempotently.
 * 
 * Supports:
 *   - SBA 7(a), SBA Express, SBA 504
 *   - Conventional Cash Flow, Conventional CRE
 * 
 * Stages:
 *   S1: Intake normalize (docs, structured data, connected accounts)
 *   S2: Run agent swarm (parallel where safe) with policy pack
 *   S3: Claims ingest + conflict set build
 *   S4: Apply bank overlay
 *   S5: Arbitration reconcile
 *   S6: Materialize deal truth snapshot
 *   S7: Generate conditions + borrower tasks
 *   S8: Generate narrative memo + evidence mapping (policy-aware)
 *   S9: Assemble package bundle (PDF/DOCX + evidence index)
 */

import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assemblePackageBundle } from "./package-bundle";
import { evaluateDocumentSubstitutions } from "@/lib/connect/substitutions";
import { orchestrator as agentOrchestrator } from "@/lib/agents";
import { ingestClaimsForDeal } from "@/lib/arbitration/ingestClaims";
import { reconcileConflictsForDeal } from "@/lib/arbitration/reconcileConflicts";
import { materializeTruthSnapshotForDeal } from "@/lib/arbitration/materializeTruthSnapshot";

export type PipelineStage =
  | "S1_INTAKE"
  | "S2_AGENTS"
  | "S3_CLAIMS"
  | "S4_OVERLAYS"
  | "S5_ARBITRATION"
  | "S6_TRUTH"
  | "S7_CONDITIONS"
  | "S8_NARRATIVE"
  | "S9_PACKAGE";

export type PipelineStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface PipelineRun {
  id: string;
  deal_id: string;
  bank_id: string;
  status: PipelineStatus;
  current_stage: PipelineStage;
  progress: number;
  mode: "full" | "fast";
  stage_logs: StageLog[];
  error_json?: any;
  truth_snapshot_id?: string;
  package_bundle_id?: string;
  started_at?: Date;
  finished_at?: Date;
}

export interface StageLog {
  stage: PipelineStage;
  status: "started" | "succeeded" | "failed" | "skipped";
  message: string;
  data?: any;
  timestamp: Date;
}

/**
 * Start a new autopilot pipeline run
 */
export async function startAutopilotRun(
  dealId: string,
  bankId: string,
  options: {
    mode?: "full" | "fast";
    force?: boolean;
    triggeredBy?: string;
  } = {}
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  const sb = supabaseAdmin();
  const mode = options.mode || "full";
  const force = options.force || false;

  try {
    // Check if there's already a running pipeline
    if (!force) {
      const { data: existingRun } = await sb
        .from("deal_pipeline_runs")
        .select("id, status")
        .eq("deal_id", dealId)
        .eq("status", "running")
        .single();

      if (existingRun) {
        return {
          ok: false,
          error: "Pipeline already running. Use force=true to restart.",
        };
      }
    }

    // Create new pipeline run
    const { data: run, error: runError } = await sb
      .from("deal_pipeline_runs")
      .insert({
        deal_id: dealId,
        bank_id: bankId,
        status: "queued",
        current_stage: "S1_INTAKE",
        progress: 0,
        mode,
        force_rerun: force,
        triggered_by: options.triggeredBy || "api",
      })
      .select()
      .single();

    if (runError || !run) {
      return { ok: false, error: runError?.message || "Failed to create pipeline run" };
    }

    // Execute pipeline asynchronously (don't await the HTTP response on it),
    // but register it with Next's after() so the serverless function isn't
    // torn down mid-pipeline once the response streams back — a bare
    // fire-and-forget .catch() has no such guarantee on Vercel.
    after(() =>
      executeAutopilotPipeline(run.id, dealId, bankId, mode).catch((err) => {
        console.error(`[Autopilot] Fatal error in pipeline ${run.id}:`, err);
      }),
    );

    return { ok: true, runId: run.id };
  } catch (err) {
    console.error("[Autopilot] Failed to start run:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Execute the full autopilot pipeline
 */
async function executeAutopilotPipeline(
  runId: string,
  dealId: string,
  bankId: string,
  mode: "full" | "fast"
): Promise<void> {
  const sb = supabaseAdmin();

  try {
    // Mark as running
    await sb
      .from("deal_pipeline_runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", runId);

    // Execute stages sequentially
    await executeStage1_Intake(runId, dealId, bankId);
    await updateProgress(runId, "S1_INTAKE", 11);

    await executeStage2_Agents(runId, dealId, bankId);
    await updateProgress(runId, "S2_AGENTS", 22);

    await executeStage3_Claims(runId, dealId, bankId);
    await updateProgress(runId, "S3_CLAIMS", 33);

    await executeStage4_Overlays(runId, dealId, bankId);
    await updateProgress(runId, "S4_OVERLAYS", 44);

    await executeStage5_Arbitration(runId, dealId, bankId);
    await updateProgress(runId, "S5_ARBITRATION", 55);

    await executeStage6_Truth(runId, dealId, bankId);
    await updateProgress(runId, "S6_TRUTH", 66);

    await executeStage7_Conditions(runId, dealId, bankId);
    await updateProgress(runId, "S7_CONDITIONS", 77);

    await executeStage8_Narrative(runId, dealId, bankId);
    await updateProgress(runId, "S8_NARRATIVE", 88);

    await executeStage9_Package(runId, dealId, bankId);
    await updateProgress(runId, "S9_PACKAGE", 100);

    // Mark as succeeded
    await sb
      .from("deal_pipeline_runs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    await logStage(runId, "S9_PACKAGE", "succeeded", "Pipeline completed successfully");
  } catch (err) {
    console.error(`[Autopilot] Pipeline ${runId} failed:`, err);

    await sb
      .from("deal_pipeline_runs")
      .update({
        status: "failed",
        error_json: {
          message: err instanceof Error ? err.message : "Unknown error",
          stack: err instanceof Error ? err.stack : undefined,
        },
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }
}

/**
 * Stage 1: Intake Normalize
 */
async function executeStage1_Intake(runId: string, dealId: string, bankId: string) {
  await logStage(runId, "S1_INTAKE", "started", "Normalizing intake data + evaluating connected accounts");

  // Evaluate document substitutions from connected accounts
  const substitutionResult = await evaluateDocumentSubstitutions({ dealId, bankId });
  
  await logStage(runId, "S1_INTAKE", "succeeded", `Intake normalized. ${substitutionResult.substitutions_applied} docs auto-satisfied, +${substitutionResult.total_readiness_boost}% boost`);
}

/**
 * Stage 2: Run Agent Swarm
 */
async function executeStage2_Agents(runId: string, dealId: string, bankId: string) {
  await logStage(runId, "S2_AGENTS", "started", "Running agent swarm");

  // In-process call (not an HTTP round-trip to /agents/execute) — a
  // server-to-server fetch back into this same app carries no Clerk
  // session, so getCurrentBankId() on the receiving end would always
  // throw "not_authenticated" and this stage would fail on every run.
  // bankId is already authenticated/validated by whoever called
  // startAutopilotRun, so calling the orchestrator directly is both
  // correct and strictly faster.
  const result = await agentOrchestrator.executeSBAUnderwritingPipeline({
    deal_id: dealId,
    bank_id: bankId,
  });

  // Per-agent failures (e.g. the 5 of 9 agent names — credit, collateral,
  // management, narrative, evidence — that have no registered
  // implementation yet) are caught inside executeAgents() and don't throw
  // here; surface them honestly in the stage log instead of reporting a
  // blanket "succeeded" that hides a degraded run.
  const failedAgents = result.errors.map((e) => e.agent_name).join(", ");
  const message = result.errors.length > 0
    ? `${result.findings.length}/${result.agents_executed.length} agents completed (failed: ${failedAgents})`
    : `${result.findings.length}/${result.agents_executed.length} agents completed`;

  await logStage(runId, "S2_AGENTS", "succeeded", message, {
    findings: result.findings.length,
    errors: result.errors,
  });
}

/**
 * Stage 3: Claims Ingest
 */
async function executeStage3_Claims(runId: string, dealId: string, bankId: string) {
  await logStage(runId, "S3_CLAIMS", "started", "Ingesting claims");

  const result = await ingestClaimsForDeal(dealId, bankId);

  await logStage(
    runId,
    "S3_CLAIMS",
    "succeeded",
    `${result.claims_created} claims ingested, ${result.conflict_sets_created} conflict sets`,
  );
}

/**
 * Stage 4: Apply Bank Overlays
 */
async function executeStage4_Overlays(runId: string, dealId: string, bankId: string) {
  void dealId;
  void bankId;
  // Bank overlays are actually applied during reconciliation (S5, see
  // executeStage5_Arbitration's applyBankOverlay:true), not here — this
  // stage does no real work of its own. Logged as "skipped", not
  // "succeeded", so the stage log doesn't claim work that didn't happen.
  await logStage(runId, "S4_OVERLAYS", "skipped", "No standalone overlay step — applied during S5 reconciliation");
}

/**
 * Stage 5: Arbitration Reconcile
 */
async function executeStage5_Arbitration(runId: string, dealId: string, bankId: string) {
  await logStage(runId, "S5_ARBITRATION", "started", "Reconciling conflicts");

  // applyBankOverlay:true here, not at S4 — see executeStage4_Overlays.
  const result = await reconcileConflictsForDeal(dealId, bankId, { applyBankOverlay: true });

  await logStage(
    runId,
    "S5_ARBITRATION",
    "succeeded",
    result.decisions_made > 0
      ? `${result.decisions_made} decisions made (${result.needs_human_review ?? 0} need human review)`
      : result.message || "No open conflicts to reconcile",
  );
}

/**
 * Stage 6: Materialize Truth Snapshot
 */
async function executeStage6_Truth(runId: string, dealId: string, bankId: string) {
  await logStage(runId, "S6_TRUTH", "started", "Materializing truth snapshot");

  const result = await materializeTruthSnapshotForDeal(dealId, bankId);

  if (!result.truth_snapshot_created) {
    // No arbitration_decisions rows yet (e.g. no agent findings/claims
    // exist for this deal) — honest "skipped", not a fabricated "v? created".
    await logStage(runId, "S6_TRUTH", "skipped", result.message || "No decisions to materialize");
    return;
  }

  const sb = supabaseAdmin();
  await sb
    .from("deal_pipeline_runs")
    .update({ truth_snapshot_id: result.snapshot_id })
    .eq("id", runId);

  await logStage(runId, "S6_TRUTH", "succeeded", `Truth snapshot v${result.version} created`);
}

/**
 * Stage 7: Generate Conditions
 */
async function executeStage7_Conditions(runId: string, dealId: string, bankId: string) {
  void dealId;
  void bankId;
  // TODO: no conditions-evaluation API exists yet — logged as "skipped",
  // not a fabricated "succeeded", so the audit trail stays honest.
  await logStage(runId, "S7_CONDITIONS", "skipped", "Conditions evaluation not yet implemented");
}

/**
 * Stage 8: Generate Narrative
 */
async function executeStage8_Narrative(runId: string, dealId: string, bankId: string) {
  void dealId;
  void bankId;
  // TODO: the `narrative` agent (src/lib/agents/) has no implementation
  // yet — logged as "skipped", not a fabricated "succeeded".
  await logStage(runId, "S8_NARRATIVE", "skipped", "Narrative agent not yet implemented");
}

/**
 * Stage 9: Assemble Package Bundle
 */
async function executeStage9_Package(runId: string, dealId: string, bankId: string) {
  await logStage(runId, "S9_PACKAGE", "started", "Assembling package bundle");

  const sb = supabaseAdmin();

  // Get truth snapshot ID from pipeline run
  const { data: run } = await sb
    .from("deal_pipeline_runs")
    .select("truth_snapshot_id")
    .eq("id", runId)
    .single();

  if (!run?.truth_snapshot_id) {
    throw new Error("No truth snapshot found for package assembly");
  }

  // Assemble bundle
  const result = await assemblePackageBundle(dealId, bankId, run.truth_snapshot_id);

  if (!result.ok) {
    throw new Error(result.error || "Package assembly failed");
  }

  // Store bundle ID in pipeline run
  await sb
    .from("deal_pipeline_runs")
    .update({ package_bundle_id: result.bundleId })
    .eq("id", runId);

  await logStage(runId, "S9_PACKAGE", "succeeded", "Package bundle ready for download");
}

/**
 * Update pipeline progress
 */
async function updateProgress(runId: string, stage: PipelineStage, progress: number) {
  const sb = supabaseAdmin();
  await sb
    .from("deal_pipeline_runs")
    .update({ current_stage: stage, progress, updated_at: new Date().toISOString() })
    .eq("id", runId);
}

/**
 * Log stage execution
 */
async function logStage(
  runId: string,
  stage: PipelineStage,
  status: "started" | "succeeded" | "failed" | "skipped",
  message: string,
  data?: any
) {
  const sb = supabaseAdmin();

  const { data: run } = await sb
    .from("deal_pipeline_runs")
    .select("stage_logs")
    .eq("id", runId)
    .single();

  const stageLogs = run?.stage_logs || [];
  const newLog = {
    stage,
    status,
    message,
    data,
    timestamp: new Date().toISOString(),
  };

  await sb
    .from("deal_pipeline_runs")
    .update({
      stage_logs: [...stageLogs, newLog],
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

/**
 * Get pipeline run status
 */
export async function getAutopilotStatus(runId: string): Promise<PipelineRun | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_pipeline_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as PipelineRun;
}
