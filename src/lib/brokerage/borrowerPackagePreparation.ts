import "server-only";
import { assertPackageBudgetAvailable } from "./trident/packageBudget";
import { borrowerPackageFailure } from "@/lib/borrower/guidedPackage/completion";
import { packageCompletionItems } from "@/lib/borrower/guidedPackage/completion";

import { start } from "workflow/api";
import { FatalError } from "workflow";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadGuidedPackage } from "@/lib/borrower/guidedPackage/service";
import { runBuddyValidationPass } from "@/lib/validation/buddyValidationPass";
import { buildResearchEntityProfile } from "@/lib/research/buildResearchSubject";
import { startResearchMission } from "@/lib/research/startResearchMission";
import { generateRunKey } from "@/lib/research/orchestration";
import { borrowerPackagePreparationWorkflow } from "@/workflows/borrowerPackagePreparation";
import { getTridentReadiness } from "./trident/tridentReadiness";
import { startTridentGeneration } from "./trident/startTridentGeneration";
import type { PackagePreparationStatus } from "./borrowerPackagePreparationState";

export type PreparationArgs = { id: string; dealId: string; bankId: string };
const RETRY_MESSAGE = "Buddy could not finish preparing your package. Please retry. If this continues, contact Buddy support.";

export async function readBorrowerPackagePreparation(dealId: string, bankId: string): Promise<PackagePreparationStatus | null> {
  const { data, error } = await supabaseAdmin().from("borrower_package_preparations")
    .select("id,status,stage,message,bundle_id,expires_at")
    .eq("deal_id", dealId).eq("bank_id", bankId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Your preparation status could not be loaded. Please retry.");
  if (!data) return null;
  const expired = data.status === "running" && Date.parse(data.expires_at) <= Date.now();
  return {
    id: data.id, status: expired ? "failed" : data.status, stage: data.stage,
    message: expired ? "Preparation stopped before completion. Please retry." : data.message,
    bundleId: data.bundle_id,
  };
}

/** Atomic per-deal admission. The POST only starts work; GET never starts paid work. */
export async function startBorrowerPackagePreparation(dealId: string, bankId: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("acquire_borrower_package_preparation", {
    p_deal_id: dealId, p_bank_id: bankId,
  });
  if (error || !data) return { ok: false as const, error: "Preparation could not start. Please retry." };
  if (data.bundleId) return { ok: true as const, accepted: true, alreadyRunning: true, bundleId: data.bundleId };
  if (data.reused) return { ok: true as const, accepted: true, alreadyRunning: true, preparationId: data.id };
  const args: PreparationArgs = { id: data.id, dealId, bankId };
  let run;
  try {
    run = await start(borrowerPackagePreparationWorkflow, [args]);
  } catch {
    await failBorrowerPackagePreparation(args);
    return { ok: false as const, error: RETRY_MESSAGE };
  }
  // After start succeeds, this workflow owns the row. A tracking error must
  // never release it and admit a second paid research run.
  const tracked = await sb.from("borrower_package_preparations")
    .update({ workflow_run_id: run.runId }).eq("id", args.id).eq("bank_id", bankId);
  if (tracked.error) console.error("[borrower-package] workflow identity could not be recorded", { id: args.id });
  return { ok: true as const, accepted: true, preparationId: args.id };
}

async function advance(args: PreparationArgs, values: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin().from("borrower_package_preparations")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", args.id).eq("deal_id", args.dealId).eq("bank_id", args.bankId)
    .eq("status", "running").gt("expires_at", new Date().toISOString())
    .select("id,mission_id,bundle_id,research_subject_hash").maybeSingle();
  if (error) throw new Error("preparation_progress_write_failed");
  if (!data) throw new FatalError("Preparation no longer owns this application.");
  // Tenancy can change independently of the job. Recheck before every engine.
  const deal = await supabaseAdmin().from("deals").select("id")
    .eq("id", args.dealId).eq("bank_id", args.bankId).maybeSingle();
  if (deal.error) throw new Error("preparation_tenant_read_failed");
  if (!deal.data) throw new FatalError("Application unavailable.");
  return data;
}

async function blocked(args: PreparationArgs, message: string): Promise<never> {
  await failBorrowerPackagePreparation(args, message);
  throw new FatalError(message);
}

async function checkInputs(args: PreparationArgs) {
  const sb = supabaseAdmin();
  const [readiness, answers] = await Promise.all([
    getTridentReadiness({ sb, dealId: args.dealId, bankId: args.bankId }),
    loadGuidedPackage(sb, { deal_id: args.dealId, bank_id: args.bankId }),
  ]);
  if (answers.readErrors.length) throw new Error("preparation_answers_read_failed");
  const completion = packageCompletionItems(answers);
  if (completion.length) await blocked(args, completion.map(item => item.label).join("\n"));
  if (!readiness.preparationReady) await blocked(args, readiness.preparationBlockers.join("\n"));
  return readiness;
}

export async function validateBorrowerPackage(args: PreparationArgs) {
  await advance(args, { stage: "checking" });
  const readiness = await checkInputs(args);
  // Capacity is checked before research as well as at immutable factory admission.
  try { await assertPackageBudgetAvailable({ dealId: args.dealId, bankId: args.bankId }); }
  catch (error) { await blocked(args, borrowerPackageFailure(error instanceof Error ? error.message : String(error))); }
  const synced = await supabaseAdmin().rpc("sync_borrower_package_proceeds", {
    p_run_id: args.id, p_deal_id: args.dealId, p_bank_id: args.bankId,
  });
  if (synced.error) {
    if (synced.error.code === "P0001") await blocked(args, synced.error.message);
    throw new Error("preparation_budget_sync_failed");
  }
  await advance(args, { stage: "validation" });
  const report = await runBuddyValidationPass(args.dealId);
  if (report.overallStatus === "FAIL") {
    await blocked(args, "Your financial information needs attention before Buddy can prepare the package.\n" +
      report.checks.filter(check => check.status === "BLOCK").map(check => check.message).join("\n"));
  }
  return { isTestDeal: readiness.evidence.isTestDeal };
}

export async function beginBorrowerPackageResearch(args: PreparationArgs) {
  const row = await advance(args, { stage: "research" });
  if (row.mission_id) return row.mission_id as string;
  const { subject, represented } = await buildResearchEntityProfile(supabaseAdmin(), args.dealId);
  if (!represented) await blocked(args, "Add your business name and business description before preparing the package.");
  // Existing research admission reuses the same subject/depth and resumes failed
  // checkpoints. Never force a fresh paid rerun on a borrower's double-click.
  const result = await startResearchMission({
    dealId: args.dealId, bankId: args.bankId, userId: null,
    missionType: "industry_landscape", depth: "committee", subject,
  });
  if (!result.ok) throw new Error("preparation_research_start_failed");
  await advance(args, { mission_id: result.mission_id, research_subject_hash: generateRunKey({
    deal_id: args.dealId, mission_type: "industry_landscape", depth: "committee", subject,
  }) });
  return result.mission_id;
}

export async function checkBorrowerPackageResearch(args: PreparationArgs, missionId: string) {
  await advance(args, { stage: "research" });
  const { data, error } = await supabaseAdmin().from("buddy_research_missions")
    .select("status").eq("id", missionId).eq("deal_id", args.dealId).eq("bank_id", args.bankId).maybeSingle();
  if (error || !data) throw new Error("preparation_research_status_failed");
  if (["failed", "cancelled"].includes(data.status))
    await blocked(args, "Business research could not be completed. Review your business details and retry preparation.");
  return data.status === "complete";
}

export async function generateBorrowerPackage(args: PreparationArgs) {
  const prior = await supabaseAdmin().from("borrower_package_preparations")
    .select("status,bundle_id").eq("id", args.id).eq("deal_id", args.dealId).eq("bank_id", args.bankId).maybeSingle();
  if (prior.error) throw new Error("preparation_status_read_failed");
  if (prior.data?.status === "succeeded" && prior.data.bundle_id) return prior.data.bundle_id as string;
  // Inputs may change while research runs. Re-sync and validate the current
  // budget/facts, then reject a research subject that no longer matches.
  await validateBorrowerPackage(args);
  const row = await advance(args, { stage: "generation" });
  if (row.bundle_id) return row.bundle_id as string;
  if (row.research_subject_hash) {
    const { subject } = await buildResearchEntityProfile(supabaseAdmin(), args.dealId);
    if (generateRunKey({ deal_id: args.dealId, mission_type: "industry_landscape", depth: "committee", subject }) !== row.research_subject_hash)
      await blocked(args, "Your business details changed during research. Please prepare the package again using your updated answers.");
  }
  // Re-read immediately before the final factory freezes its snapshot. No gate
  // is bypassed, and inputs edited during research cannot slip past admission.
  const readiness = await checkInputs(args);
  if (!readiness.ok) await blocked(args, readiness.reasons.map(reason =>
    reason === "memo_research_not_release_ready"
      ? "Business research needs review before the package can be prepared. Check your business details or contact Buddy support."
      : reason).join("\n"));
  const started = await startTridentGeneration({ dealId: args.dealId, mode: "final" });
  if (!started.ok) throw new Error("preparation_generation_start_failed");
  // Final generation has its own atomic lease and retryable workflow. A retry
  // after this write fails reuses that admission rather than rendering twice.
  await advance(args, { status: "succeeded", bundle_id: started.bundleId, message: null });
  return started.bundleId;
}

export async function failBorrowerPackagePreparation(args: PreparationArgs, message = RETRY_MESSAGE) {
  const { error } = await supabaseAdmin().from("borrower_package_preparations")
    .update({ status: "failed", message, updated_at: new Date().toISOString() })
    .eq("id", args.id).eq("deal_id", args.dealId).eq("bank_id", args.bankId).eq("status", "running");
  if (error) throw new Error("preparation_failure_write_failed");
}
