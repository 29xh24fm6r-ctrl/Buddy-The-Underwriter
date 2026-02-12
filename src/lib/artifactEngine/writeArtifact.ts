/**
 * Artifact Engine — Writer
 *
 * Persists a full underwrite result as an immutable, versioned artifact.
 *
 * Uses the `persist_underwrite_artifact` RPC for atomic execution:
 * 1. Advisory lock (per deal_id — prevents concurrent version races)
 * 2. Idempotency check (same overall_hash → return existing draft)
 * 3. Version auto-increment
 * 4. Supersede previous drafts (with supersedes_artifact_id chain)
 * 5. Insert new artifact row
 *
 * PHASE 7: DB write — no computation, no UI.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FinancialModel } from "@/lib/modelEngine/types";
import type { DebtInstrument } from "@/lib/debtEngine/types";
import type { UnderwriteResult } from "@/lib/underwritingEngine/types";
import { computeArtifactHashes } from "./hash";
import pkg from "../../../package.json";

// ---------------------------------------------------------------------------
// Engine version — sourced from package.json
// ---------------------------------------------------------------------------

const ENGINE_VERSION: string = pkg.version;

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
  | { ok: true; artifactId: string; version: number; overallHash: string; idempotent: boolean }
  | { ok: false; error: string }
> {
  const { dealId, bankId, result, model, bankConfigVersionId, createdBy } = args;
  const sb = supabaseAdmin();

  // 1. Compute hashes (pure, no DB)
  const hashes = computeArtifactHashes({
    model,
    snapshot: result.snapshot,
    policy: result.policy,
    stress: result.stress,
    pricing: result.pricing,
    memo: result.memo,
  });

  // 2. Atomic persist via RPC (advisory lock + idempotency + version + supersede + insert)
  const { data, error } = await sb.rpc("persist_underwrite_artifact", {
    p_deal_id: dealId,
    p_bank_id: bankId,
    p_product_type: result.pricing.product,
    p_snapshot_json: result.snapshot,
    p_analysis_json: result.analysis,
    p_policy_json: result.policy,
    p_stress_json: result.stress,
    p_pricing_json: result.pricing,
    p_memo_json: result.memo,
    p_model_hash: hashes.modelHash,
    p_snapshot_hash: hashes.snapshotHash,
    p_policy_hash: hashes.policyHash,
    p_stress_hash: hashes.stressHash,
    p_pricing_hash: hashes.pricingHash,
    p_memo_hash: hashes.memoHash,
    p_overall_hash: hashes.overallHash,
    p_engine_version: ENGINE_VERSION,
    p_bank_config_version_id: bankConfigVersionId ?? null,
    p_created_by: createdBy ?? null,
  });

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Persist RPC failed" };
  }

  return {
    ok: true,
    artifactId: data.id,
    version: data.version,
    overallHash: data.overall_hash,
    idempotent: data.idempotent === true,
  };
}
