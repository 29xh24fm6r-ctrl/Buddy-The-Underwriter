import "server-only";

import { randomUUID, createHash } from "node:crypto";
import { buildCreditMemoPdf } from "@/lib/creditMemo/pdf/buildCreditMemoPdf";
import { prepareBrokerageSbaForms, generateBrokerageForms, assembleBrokerageFormsPackage } from "@/lib/brokerage/borrowerFormsOrchestration";
import { FatalError } from "workflow";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateCanonicalMemoArtifact } from "@/lib/creditMemo/canonical/generateCanonicalMemoArtifact";
import { renderClassicPdfSpread } from "@/lib/classicSpread/classicPdfWorker";
import { assertTridentInputSnapshot, TridentSnapshotSchemaChanged } from "./tridentInputSnapshot";
import type { TridentBundleMode, TridentSbaCheckpoint } from "./generateTridentBundle";
import { persistRowWithStorageRollback } from "./artifactPersistence";

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
  const sb = supabaseAdmin();
  const { data: bundle, error } = await sb
    .from("buddy_trident_bundles")
    .select("snapshot_manifest_json")
    .eq("id", args.bundleId)
    .eq("lease_token", args.leaseToken)
    .eq("input_hash", args.inputHash)
    .maybeSingle();
  if (error || !bundle) throw new FatalError(error?.message ?? "Golden Trident snapshot manifest is unavailable");
  await assertTridentInputSnapshot({
    sb,
    dealId: args.dealId,
    expectedHash: args.inputHash,
    expectedManifest: bundle.snapshot_manifest_json as Record<string, unknown> | null,
  });
}

export async function prepareTridentFactory(args: TridentFactoryArgs) {
  const sb = supabaseAdmin();
  await writeStage(args, "input_snapshot", "running");
  try {
    const { data: bundle, error } = await sb.from("buddy_trident_bundles")
      .select("id,deal_id,bank_id,mode,input_hash,memo_input_hash,snapshot_manifest_json,status")
      .eq("id", args.bundleId).eq("deal_id", args.dealId).eq("mode", args.mode).single();
    if (error || !bundle || !bundle.input_hash || !bundle.memo_input_hash || !bundle.bank_id) {
      throw new FatalError("Golden Trident run identity is invalid");
    }
    await assertTridentInputSnapshot({
      sb,
      dealId: args.dealId,
      expectedHash: String(bundle.input_hash),
      expectedManifest: bundle.snapshot_manifest_json as Record<string, unknown> | null,
    });
    if (args.mode === "final") {
      // Resolve the actual forms before spending on financial narratives.
      const prepared = await prepareBrokerageSbaForms(args.dealId, sb, { refresh: true });
      if (!prepared.ok) throw new FatalError(prepared.reason);
      const generated = await generateBrokerageForms(args.dealId, sb);
      if (!generated.ok) throw new FatalError(generated.reason);
      const failures = generated.results.filter(item => !item.ok);
      if (failures.length) throw new FatalError(`Complete these forms first: ${failures.map(item => item.error).join("; ")}`);
      const forms = await assembleBrokerageFormsPackage(args.dealId, sb);
      if (!forms.ok) throw new FatalError(`SBA forms: ${"detail" in forms ? forms.detail : forms.reason}`);
      const { data: file, error: fileError } = await sb.storage.from("bank-forms").download(forms.storagePath);
      if (fileError || !file) throw new Error("Assembled SBA forms could not be read");
      await storeBundlePdf(args, "sba_forms_pdf_path", Buffer.from(await file.arrayBuffer()));
    }
    await writeStage(args, "input_snapshot", "succeeded", {
      inputHash: bundle.input_hash,
      bankId: bundle.bank_id,
    });
    return { bankId: String(bundle.bank_id), inputHash: String(bundle.input_hash), memoInputHash: String(bundle.memo_input_hash) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeStage(args, "input_snapshot", "failed", { message });
    // A schema-generation change is not transient and not the borrower's
    // doing. Retrying re-reads the same superseded manifest and fails
    // identically, so surface it as terminal on the first attempt instead of
    // spending three and reporting it as input drift.
    if (error instanceof TridentSnapshotSchemaChanged) throw new FatalError(message);
    throw error;
  }
}

export async function generateCanonicalFactoryArtifacts(args: TridentFactoryExecutionArgs) {
  if (args.mode !== "final") {
    await writeStage(args, "canonical_credit", "skipped", { reason: "preview_mode" });
    return { memoInputHash: args.memoInputHash };
  }
  await writeStage(args, "canonical_credit", "running");
  let failureDetail: Record<string, unknown> = {};
  try {
    await assertFrozen(args);
    // Classic Spread is the canonical financial materializer. Run it first so
    // the memo and all downstream artifacts bind to the resulting stable
    // financial snapshot rather than to the pre-materialization snapshot.
    const spread = await renderClassicPdfSpread({ dealId: args.dealId, bankId: args.bankId });
    if (!spread.ok) {
      if (spread.errorCode === "PREFLIGHT_BLOCKED") throw new FatalError(spread.error);
      throw new Error(spread.error);
    }
    await assertFrozen(args);

    const memo = await generateCanonicalMemoArtifact({
      dealId: args.dealId,
      bankId: args.bankId,
      forceRegenerate: false,
      executionContext: "system",
    });
    if (!memo.ok) {
      const verification =
        "verification" in memo && memo.verification ? memo.verification : null;
      const findings = verification?.flaggedClaims ?? [];
      const findingSummary = findings
        .slice(0, 3)
        .map((finding) =>
          `${finding.severity}: ${finding.reason}`.slice(0, 240),
        );
      const message =
        memo.error + (findingSummary.length > 0 ? ` — ${findingSummary.join(" | ")}` : "");
      failureDetail = {
        verification: verification
          ? {
              verdict: verification.verdict,
              repaired: verification.repaired,
              reviewPasses: verification.reviewPasses,
              conditionsCreated: verification.conditionsCreated,
              conditionsSkipped: verification.conditionsSkipped,
              flaggedClaims: findings,
            }
          : null,
      };
      throw new FatalError(message);
    }
    await assertFrozen(args);
    const sb = supabaseAdmin();
    const { data: spreadRow, error: spreadReadError } = await sb.from("deal_spreads").select("id,rendered_json")
      .eq("deal_id", args.dealId).eq("bank_id", args.bankId)
      .eq("spread_type", "CLASSIC_PDF").eq("status", "ready")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (spreadReadError || !spreadRow?.id || !memo.memoId) {
      throw new Error(spreadReadError?.message ?? "Canonical credit artifacts were not durably persisted");
    }
    const spreadPayload = spreadRow.rendered_json as { pdf_base64?: string; pdf_sha256?: string };
    const spreadBytes = Buffer.from(spreadPayload.pdf_base64 ?? "", "base64");
    if (createHash("sha256").update(spreadBytes).digest("hex") !== spreadPayload.pdf_sha256) throw new Error("Spread PDF integrity check failed");
    await storeBundlePdf(args, "spreads_pdf_path", spreadBytes);
    // This is a prepared lender memo, not a banker certification or credit decision.
    const memoBytes = await buildCreditMemoPdf(memo.canonicalMemo, { draft: true });
    await storeBundlePdf(args, "credit_memo_pdf_path", memoBytes);
    await persistRowWithStorageRollback(sb, {
      table: "buddy_trident_bundles",
      filters: {
        id: args.bundleId,
        bank_id: args.bankId,
        input_hash: args.inputHash,
        lease_token: args.leaseToken,
      },
      values: {
        source_credit_memo_id: memo.memoId,
        source_spread_id: spreadRow.id,
        memo_input_hash: memo.inputHash,
        canonical_memo_input_hash: memo.inputHash,
      },
      expected: {
        source_credit_memo_id: memo.memoId,
        source_spread_id: spreadRow.id,
        memo_input_hash: memo.inputHash,
        canonical_memo_input_hash: memo.inputHash,
      },
      uploaded: [],
      label: "Canonical credit artifact",
    });
    await writeStage(args, "canonical_credit", "succeeded", {
      memoId: memo.memoId,
      spreadId: spreadRow.id,
      memoInputHash: memo.inputHash,
      spreadSha256: spread.pdfSha256,
    });
    return { memoInputHash: memo.inputHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeStage(args, "canonical_credit", "failed", {
      ...failureDetail,
      message,
    });
    throw error;
  }
}

export async function generateSbaFactoryCheckpoint(
  args: TridentFactoryExecutionArgs,
): Promise<TridentSbaCheckpoint> {
  await writeStage(args, "sba_package", "running");
  try {
    await assertFrozen(args);
    const { generateTridentSbaCheckpoint } = await import("./generateTridentBundle");
    const checkpoint = await generateTridentSbaCheckpoint(args);
    await assertFrozen(args);
    await writeStage(args, "sba_package", "succeeded", {
      packageId: checkpoint.packageId,
      pdfUrl: checkpoint.pdfUrl,
    });
    return checkpoint;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeStage(args, "sba_package", "failed", { message });
    throw error;
  }
}

export async function runArtifactFactory(args: TridentFactoryExecutionArgs, sbaCheckpoint?: TridentSbaCheckpoint) {
  await writeStage(args, "artifact_factory", "running");
  try {
    await assertFrozen(args);
    const { generateTridentBundle } = await import("./generateTridentBundle");
    const result = await generateTridentBundle({ ...args, sbaCheckpoint });
    if (!result.ok) {
      const permanent = /institutional review|release blocked|acceptance failed|not ready|input_snapshot_changed|snapshot_schema_superseded/i.test(result.error);
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
      .select("status,bank_id,input_hash,release_gate_json,business_plan_pdf_path,projections_xlsx_path,feasibility_pdf_path,source_credit_memo_id,source_spread_id,credit_memo_pdf_path,spreads_pdf_path,sba_forms_pdf_path")
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
    if (args.mode === "final" && (!data.credit_memo_pdf_path || !data.spreads_pdf_path || !data.sba_forms_pdf_path)) {
      throw new FatalError("The lender package is missing its memo, spreads, or SBA forms");
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

async function storeBundlePdf(args: TridentFactoryArgs, column: "sba_forms_pdf_path" | "spreads_pdf_path" | "credit_memo_pdf_path", bytes: Buffer) {
  if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error(`Invalid PDF: ${column}`);
  const sb = supabaseAdmin();
  const path = `${args.dealId}/final/${args.bundleId}/${randomUUID()}_${column}.pdf`;
  const { data, error } = await sb.storage.from("trident-bundles").upload(path, bytes, { contentType: "application/pdf" });
  if (error || data?.path !== path) throw new Error(`Package PDF save failed: ${error?.message ?? column}`);
  await persistRowWithStorageRollback(sb, {
    table: "buddy_trident_bundles", filters: { id: args.bundleId, lease_token: args.leaseToken },
    values: { [column]: path }, expected: { [column]: path },
    uploaded: [{ bucket: "trident-bundles", path }], label: column,
  });
}
