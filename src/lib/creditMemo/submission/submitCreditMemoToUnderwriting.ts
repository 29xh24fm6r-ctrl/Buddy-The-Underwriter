// Banker-initiated credit memo submission to underwriting.
//
// Ownership invariant: Buddy assembles, Banker submits. This file is the
// ONLY caller permitted to write status='banker_submitted' to the
// credit_memo_snapshots table — enforced by ownershipInvariantGuard.test.ts.
//
// Behavior:
//   1. Build canonical memo (Buddy assembly).
//   2. Load banker overrides.
//   3. Evaluate readiness contract — server-side, not UI.
//   4. If any blocker fails → reject submission (no DB write).
//   5. Compute deterministic input hash.
//   6. Determine next memo_version for this deal.
//   7. Insert frozen snapshot with status='banker_submitted'.
//
// The submitted snapshot is the system of record for what the banker
// certified. Subsequent edits create a new memo_version row, never mutate
// this one.

import "server-only";

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { buildMemoInputPackage } from "@/lib/creditMemo/inputs/buildMemoInputPackage";
import { evaluateMemoInputReadiness } from "@/lib/creditMemo/inputs/evaluateMemoInputReadiness";
import { evaluateMemoReadinessContract } from "./evaluateMemoReadinessContract";
import { computeInputHash } from "./computeInputHash";
import { buildMemoOutput } from "./buildMemoOutput";
import { FloridaArmoryBuildError } from "@/lib/creditMemo/snapshot/types";
import type {
  BankerCertification,
  DataSourcesManifest,
  MemoSubmissionResult,
  ReadinessWarningKey,
} from "./types";

export type SubmitCreditMemoArgs = {
  dealId: string;
  bankerId: string;
  bankerNotes?: string | null;
  acknowledgedWarnings?: ReadinessWarningKey[];
};

export async function submitCreditMemoToUnderwriting(
  args: SubmitCreditMemoArgs,
): Promise<MemoSubmissionResult> {
  if (!args.bankerId || args.bankerId.trim().length === 0) {
    return { ok: false, reason: "missing_banker_id" };
  }

  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;

  // ── Memo Input Completeness Layer ─────────────────────────────────────
  // Authoritative gate: evaluateMemoInputReadiness runs over the assembled
  // package and rejects submissions that cannot prove story / management /
  // collateral / financials / research / conflicts are all satisfied.
  // CI guard memoInputCompletenessGuard.test.ts enforces this call site.
  const inputPackageResult = await buildMemoInputPackage({
    dealId: args.dealId,
    runReconciliation: true,
  });
  if (!inputPackageResult.ok) {
    return {
      ok: false,
      reason: "input_readiness_failed",
      error: inputPackageResult.error ?? inputPackageResult.reason,
    };
  }
  const inputPackage = inputPackageResult.package;
  const inputReadiness = evaluateMemoInputReadiness({
    dealId: args.dealId,
    borrowerStory: inputPackage.borrower_story,
    management: inputPackage.management_profiles,
    collateral: inputPackage.collateral_items,
    financialFacts: inputPackage.financial_facts,
    research: inputPackage.research,
    conflicts: inputPackage.conflicts.filter(
      (c) => c.status === "open" || c.status === "acknowledged",
    ),
  });
  if (!inputReadiness.ready) {
    return {
      ok: false,
      reason: "input_readiness_failed",
      inputReadiness,
    };
  }

  const memoResult = await buildCanonicalCreditMemo({
    dealId: args.dealId,
    bankId,
    preparedBy: args.bankerId,
    renderMode: "committee",
  });

  if (!memoResult.ok) {
    return {
      ok: false,
      reason: "memo_load_failed",
      error: memoResult.error,
    };
  }

  const memo = memoResult.memo;

  const sb = supabaseAdmin();

  const overrides = await loadOverrides(sb, args.dealId, bankId);

  const readiness = evaluateMemoReadinessContract({ memo, overrides });
  if (!readiness.passed) {
    return { ok: false, reason: "readiness_failed", readiness };
  }

  const inputHash = computeInputHash({
    memo,
    overrides,
    bankerId: args.bankerId,
  });

  const nextVersion = await nextMemoVersion(sb, args.dealId);

  const submittedAt = new Date().toISOString();

  const certification: BankerCertification = {
    banker_id: args.bankerId,
    certified_at: submittedAt,
    reviewed_tabs: readArray(overrides["tabs_viewed"]),
    acknowledged_warnings: args.acknowledgedWarnings ?? [],
    banker_notes:
      typeof args.bankerNotes === "string" && args.bankerNotes.trim().length > 0
        ? args.bankerNotes
        : null,
    qualitative_overrides_present: hasQualitativeOverrides(overrides),
    covenant_adjustments_present: hasCovenantAdjustments(overrides),
  };

  const dataSources: DataSourcesManifest = {
    canonical_memo_generated_at: memo.generated_at,
    overrides_keys: Object.keys(overrides).sort(),
    financial_snapshot_present: hasSnapshotFinancials(memo),
    research_present: memo.business_industry_analysis !== null,
    pricing_decision_present: hasPricingDecision(memo),
  };

  // Pre-generate the snapshot id so meta.snapshot_id inside the payload
  // matches the DB row's primary key. This is what makes the snapshot
  // self-contained — the underwriter can rebuild the memo from the JSON
  // alone, no joins needed.
  const snapshotId = randomUUID();

  let memoOutput: ReturnType<typeof buildMemoOutput>;
  try {
    memoOutput = buildMemoOutput({
      dealId: args.dealId,
      bankId,
      bankerId: args.bankerId,
      memoVersion: nextVersion,
      inputHash,
      canonicalMemo: memo,
      readinessContract: readiness,
      overrides,
      submittedAt,
      snapshotId,
    });
  } catch (e) {
    const message =
      e instanceof FloridaArmoryBuildError
        ? `florida_armory:${e.code}:${e.missingFields.join(",")}`
        : String(e);
    return {
      ok: false,
      reason: "persist_failed",
      readiness,
      error: message,
    };
  }

  const insertRes = await sb
    .from("credit_memo_snapshots")
    .insert({
      id: snapshotId,
      deal_id: args.dealId,
      generated_by: args.bankerId,
      generated_at: submittedAt,
      builder_state_json: {
        source: "buildFloridaArmorySnapshot",
        render_mode: "committee",
        schema_version: memoOutput.schema_version,
      },
      policy_exceptions_json: [],
      builder_decisions_json: [],
      memo_output_json: memoOutput as unknown as Record<string, unknown>,
      // ── Banker submission lifecycle ──────────────────────────────────
      status: "banker_submitted",
      submitted_by: args.bankerId,
      submitted_at: memoOutput.meta.submitted_at,
      submission_role: "banker",
      memo_version: nextVersion,
      input_hash: inputHash,
      readiness_contract_json: readiness as unknown as Record<string, unknown>,
      data_sources_json: {
        manifest: dataSources,
        sources: memoOutput.sources,
        memo_input_package: inputPackage,
        memo_input_readiness: inputReadiness,
      } as unknown as Record<string, unknown>,
      banker_certification_json: {
        certification,
        snapshot_banker_submission: memoOutput.banker_submission,
      } as unknown as Record<string, unknown>,
      underwriter_feedback_json: {},
    })
    .select("id")
    .single();

  if (insertRes.error || !insertRes.data) {
    return {
      ok: false,
      reason: "persist_failed",
      readiness,
      error: insertRes.error?.message ?? "unknown",
    };
  }

  // Perfect Banker Flow v1.1 — submission just changed lifecycle-relevant
  // state (memo is now banker_submitted). Refresh readiness so the rail
  // flips DealShell's CTA to "View Submitted Memo" without a manual reload.
  try {
    const { scheduleReadinessRefresh } = await import(
      "@/lib/deals/readiness/refreshDealReadiness"
    );
    scheduleReadinessRefresh({
      dealId: args.dealId,
      trigger: "credit_memo_submitted",
      actorId: args.bankerId,
    });
  } catch {
    // Refresh is best-effort.
  }

  return {
    ok: true,
    snapshotId: insertRes.data.id as string,
    memoVersion: nextVersion,
    readiness,
    inputReadiness,
    inputHash,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadOverrides(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<Record<string, unknown>> {
  const { data } = await sb
    .from("deal_memo_overrides")
    .select("overrides")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();
  const raw = (data as { overrides?: unknown } | null)?.overrides;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

async function nextMemoVersion(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<number> {
  const { data } = await sb
    .from("credit_memo_snapshots")
    .select("memo_version")
    .eq("deal_id", dealId)
    .order("memo_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const current = (data as { memo_version?: number } | null)?.memo_version;
  return typeof current === "number" && current >= 1 ? current + 1 : 1;
}

function readArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is string => typeof s === "string");
}

function hasQualitativeOverrides(overrides: Record<string, unknown>): boolean {
  return [
    "qualitative_override_character",
    "qualitative_override_capital",
    "qualitative_override_conditions",
    "qualitative_override_management",
    "qualitative_override_business_model",
  ].some((k) => {
    const v = overrides[k];
    return v && typeof v === "object";
  });
}

function hasCovenantAdjustments(overrides: Record<string, unknown>): boolean {
  const v = overrides["covenant_adjustments"];
  return Array.isArray(v) && v.length > 0;
}

function hasSnapshotFinancials(memo: {
  financial_analysis: { dscr: { value: number | null } };
}): boolean {
  return memo.financial_analysis.dscr.value !== null;
}

function hasPricingDecision(memo: {
  key_metrics: { rate_initial_pct: number | null };
}): boolean {
  return memo.key_metrics.rate_initial_pct !== null;
}

