/**
 * Artifact Engine — Writer
 *
 * Persists a full underwrite result as an immutable, versioned artifact.
 *
 * Steps:
 * 1. Compute all component hashes
 * 2. Get next version (auto-increment per deal)
 * 3. Supersede any previous draft artifacts for this deal
 * 4. Insert new artifact row
 *
 * PHASE 7: DB write — no computation, no UI.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FinancialModel } from "@/lib/modelEngine/types";
import type { DebtInstrument } from "@/lib/debtEngine/types";
import type { UnderwriteResult } from "@/lib/underwritingEngine/types";
import { computeArtifactHashes } from "./hash";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createUnderwriteArtifact(args: {
  dealId: string;
  bankId: string;
  result: UnderwriteResult;
  model: FinancialModel;
  instruments?: DebtInstrument[];
  bankConfigVersionId?: string;
  createdBy?: string;
}): Promise<
  | { ok: true; artifactId: string; version: number; overallHash: string }
  | { ok: false; error: string }
> {
  const { dealId, bankId, result, model, bankConfigVersionId, createdBy } = args;
  const sb = supabaseAdmin();

  // 1. Compute hashes
  const hashes = computeArtifactHashes({
    model,
    snapshot: result.snapshot,
    policy: result.policy,
    stress: result.stress,
    pricing: result.pricing,
    memo: result.memo,
  });

  // 2. Get next version
  const { data: maxRow } = await sb
    .from("underwrite_artifacts")
    .select("version")
    .eq("deal_id", dealId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (maxRow?.version ?? 0) + 1;

  // 3. Supersede previous drafts
  await sb
    .from("underwrite_artifacts")
    .update({ status: "superseded" })
    .eq("deal_id", dealId)
    .eq("status", "draft");

  // 4. Insert new artifact
  const { data: inserted, error } = await sb
    .from("underwrite_artifacts")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      product_type: result.pricing.product,
      version: nextVersion,
      status: "draft",

      snapshot_json: result.snapshot,
      analysis_json: result.analysis,
      policy_json: result.policy,
      stress_json: result.stress,
      pricing_json: result.pricing,
      memo_json: result.memo,

      model_hash: hashes.modelHash,
      snapshot_hash: hashes.snapshotHash,
      policy_hash: hashes.policyHash,
      stress_hash: hashes.stressHash,
      pricing_hash: hashes.pricingHash,
      memo_hash: hashes.memoHash,
      overall_hash: hashes.overallHash,

      engine_version: "1.0.0",
      bank_config_version_id: bankConfigVersionId ?? null,
      created_by: createdBy ?? null,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  return {
    ok: true,
    artifactId: inserted.id,
    version: nextVersion,
    overallHash: hashes.overallHash,
  };
}
