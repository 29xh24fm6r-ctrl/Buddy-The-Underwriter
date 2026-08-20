import "server-only";

import { FatalError } from "workflow";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateCanonicalMemoArtifact } from "@/lib/creditMemo/canonical/generateCanonicalMemoArtifact";
import { renderClassicPdfSpread } from "@/lib/classicSpread/classicPdfWorker";
import { assertTridentInputSnapshot } from "./tridentInputSnapshot";
import type { TridentBundleMode } from "./generateTridentBundle";

export type TridentFactoryArgs = {
  dealId: string;
  mode: TridentBundleMode;
  bundleId: string;
  leaseToken: string;
};
export type TridentFactoryExecutionArgs = TridentFactoryArgs & {
  bankId: string;
  inputHash: string;
  memoInputHash: string;
};

async function writeStage(
  args: TridentFactoryArgs & { inputHash?: string },
  stage: string,
  status: "running" | "succeeded" | "failed" | "skipped",
  detail?: Record<string, unknown>,
) {
  if (!args.inputHash) {
    // Preparation has not loaded the admitted hash yet, so validate the lease
    // and obtain it before invoking the same CAS RPC used by every later stage.
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("buddy_trident_bundles")
      .select("input_hash")
      .eq("id", args.bundleId)
      .eq("lease_token", args.leaseToken)
      .in("status", ["pending", "running"])
      .maybeSingle();
    if (error || !data?.input_hash) throw new FatalError("Golden Trident lease is no longer active");
    args = { ...args, inputHash: String(data.input_hash) };
  }
  const { data, error } = await supabaseAdmin().rpc("record_trident_bundle_stage", {
    p_bundle_id: args.bundleId,
    p_lease_token: args.leaseToken,
    p_input_hash: args.inputHash,
    p_stage: stage,
    p_status: status,
    p_detail: detail ?? {},
  });
  if (error || data !== true) {
    throw new FatalError(error?.message ?? "Golden Trident stage CAS failed");
  }
}

async function assertFrozen(args: TridentFactoryExecutionArgs) {
  await assertTridentInputSnapshot({
    sb: supabaseAdmin(),
    dealId: args.dealId,
    expectedHash: args.inputHash,
  });
}

export async function prepareTridentFactory(args: TridentFactoryArgs) {
  const sb = supabaseAdmin();
  await writeStage(args, "input_snapshot", "running");
  try {
    const { data: bundle, error } = await sb.from("buddy_trident_bundles")
      .select("id,deal_id,bank_id,mode,input_hash,memo_input_hash,status")
      .eq("id", args.bundleId).eq("deal_id", args.dealId).eq("mode", args.mode).single();
    if (error || !bundle || !bundle.input_hash || !bundle.memo_input_hash || !bundle.bank_id) {
      throw new FatalError("Golden Trident run identity is invalid");
    }
    await assertTridentInputSnapshot({
      sb,
      dealId: args.dealId,
      expectedHash: String(bundle.input_hash),
    });
    await writeStage(args, "input_snapshot", "succeeded", {
      inputHash: bundle.input_hash,
      bankId: bundle.bank_id,
    });
    return { bankId: String(bundle.bank_id), inputHash: String(bundle.input_hash), memoInputHash: String(bundle.memo_input_hash) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeStage(args, "input_snapshot", "failed", { message });
    throw error;
  }
}

export async function generateCanonicalFactoryArtifacts(args: TridentFactoryExecutionArgs) {
  if (args.mode !== "final") {
    await writeStage(args, "canonical_credit", "skipped", { reason: "preview_mode" });
    return;
  }
  await writeStage(args, "canonical_credit", "running");
  try {
    await assertFrozen(args);
    const memo = await generateCanonicalMemoArtifact({
      dealId: args.dealId,
      bankId: args.bankId,
      forceRegenerate: false,
      executionContext: "system",
    });
    if (!memo.ok) throw new FatalError(memo.error);
    const spread = await renderClassicPdfSpread({ dealId: args.dealId, bankId: args.bankId });
    if (!spread.ok) {
      if (spread.errorCode === "PREFLIGHT_BLOCKED") throw new FatalError(spread.error);
      throw new Error(spread.error);
    }
    await assertFrozen(args);
    const sb = supabaseAdmin();
    const { data: spreadRow, error: spreadReadError } = await sb.from("deal_spreads").select("id")
      .eq("deal_id", args.dealId).eq("bank_id", args.bankId)
      .eq("spread_type", "CLASSIC_PDF").eq("status", "ready")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (spreadReadError || !spreadRow?.id || !memo.memoId) {
      throw new Error(spreadReadError?.message ?? "Canonical credit artifacts were not durably persisted");
    }
    const { error } = await sb.from("buddy_trident_bundles").update({
      source_credit_memo_id: memo.memoId,
      source_spread_id: spreadRow.id,
      canonical_memo_input_hash: memo.inputHash,
    }).eq("id", args.bundleId)
      .eq("bank_id", args.bankId)
      .eq("input_hash", args.inputHash);
    if (error) throw new Error(error.message);
    await writeStage(args, "canonical_credit", "succeeded", {
      memoId: memo.memoId,
      spreadId: spreadRow.id,
      memoInputHash: memo.inputHash,
      spreadSha256: spread.pdfSha256,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeStage(args, "canonical_credit", "failed", { message });
    throw error;
  }
}

export async function runArtifactFactory(args: TridentFactoryExecutionArgs) {
  await writeStage(args, "artifact_factory", "running");
  try {
    await assertFrozen(args);
    const { generateTridentBundle } = await import("./generateTridentBundle");
    const result = await generateTridentBundle(args);
    if (!result.ok) {
      const permanent = /institutional review|release blocked|acceptance failed|not ready|input_snapshot_changed/i.test(result.error);
      if (permanent) throw new FatalError(result.error);
      throw new Error(result.error);
    }
    await assertFrozen(args);
    await writeStage(args, "artifact_factory", "succeeded", result.paths);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeStage(args, "artifact_factory", "failed", { message });
    throw error;
  }
}

export async function verifyTridentFactory(args: TridentFactoryExecutionArgs) {
  await writeStage(args, "release_manifest", "running");
  try {
    await assertFrozen(args);
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("buddy_trident_bundles")
      .select("status,bank_id,input_hash,release_gate_json,business_plan_pdf_path,projections_xlsx_path,feasibility_pdf_path,source_credit_memo_id,source_spread_id")
      .eq("id", args.bundleId)
      .eq("bank_id", args.bankId)
      .eq("input_hash", args.inputHash)
      .single();
    if (error || !data) throw new Error(error?.message ?? "Trident manifest missing");
    const gate = data.release_gate_json as { ok?: boolean; reasons?: string[]; warnings?: string[] } | null;
    if (!["pending", "running"].includes(data.status) || (args.mode === "final" && gate?.ok !== true)) {
      const reason = gate?.reasons?.join(", ") || "bundle_not_succeeded";
      throw new FatalError(`Golden Trident manifest verification failed: ${reason}`);
    }
    await writeStage(args, "release_manifest", "succeeded", {
      businessPlan: data.business_plan_pdf_path,
      projections: data.projections_xlsx_path,
      feasibility: data.feasibility_pdf_path,
      memoId: data.source_credit_memo_id,
      spreadId: data.source_spread_id,
      warnings: gate?.warnings ?? [],
    });
    const { data: finalized, error: finalizeError } = await sb.rpc(
      "finalize_trident_bundle_run",
      {
        p_bundle_id: args.bundleId,
        p_lease_token: args.leaseToken,
        p_input_hash: args.inputHash,
      },
    );
    if (finalizeError || finalized !== true) {
      throw new Error(finalizeError?.message ?? "Atomic Trident publication failed");
    }
    return { ok: true, bundleId: args.bundleId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeStage(args, "release_manifest", "failed", { message });
    throw error;
  }
}

export async function failTridentFactory(args: TridentFactoryArgs & { inputHash?: string }, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const sb = supabaseAdmin();
  let inputHash = args.inputHash;
  if (!inputHash) {
    const { data } = await sb.from("buddy_trident_bundles").select("input_hash")
      .eq("id", args.bundleId).eq("lease_token", args.leaseToken).maybeSingle();
    inputHash = data?.input_hash ?? undefined;
  }
  if (!inputHash) return;
  const { error: failError } = await sb.rpc("fail_trident_bundle_run", {
    p_bundle_id: args.bundleId,
    p_lease_token: args.leaseToken,
    p_input_hash: inputHash,
    p_error: message,
  });
  if (failError && !/lease lost/i.test(failError.message)) throw new Error(failError.message);
}
