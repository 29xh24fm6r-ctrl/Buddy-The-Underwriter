import "server-only";

/**
 * Phase 55C — Financial Snapshot Gate for Lifecycle / Memo / Decision
 *
 * Returns whether downstream systems can safely proceed based on:
 * - latest production financial snapshot existence + completeness
 * - open review items from deal_gap_queue
 * - snapshot freshness
 *
 * Stage-aware: blocks committee readiness, not early underwriting.
 */

import { loadSnapshotFactInputs } from "./loadSnapshotFactInputs";
import { financialFactFingerprint } from "@/lib/financialFacts/fingerprint";
import { supabaseAdmin } from "@/lib/supabase/admin";


type FinancialSnapshotEvidence = {
  snapshotExists: boolean;
  snapshotAgeHours: number | null;
  openReviewItems: number;
  unresolvedConflicts: number;
  unresolvedMissingFacts: number;
  unresolvedLowConfidenceFacts: number;
  lastBuiltAt: string | null;
  lastBuildStatus: string | null;
};

export type FinancialSnapshotGate = {
  evaluationStatus: "evaluated";
  ready: boolean;
  blockerCode:
    | "financial_snapshot_missing"
    | "financial_snapshot_stale"
    | "financial_validation_open"
    | "financial_snapshot_build_failed"
    | null;
  message: string | null;
  evidence: FinancialSnapshotEvidence;
} | {
  evaluationStatus: "unavailable";
  ready: false;
  blockerCode: "financial_validation_unavailable";
  message: string;
  evidence: null;
};

/** The immutable snapshot written by the production recompute pipeline. */
export type StoredFinancialSnapshot = {
  id: string;
  created_at: string;
  snapshot_hash: string;
  snapshot_json: { input_facts_hash?: string; completeness_pct?: number; missing_required_keys?: string[] } | null;
};

type FinancialSnapshotGateOptions = {
  client?: ReturnType<typeof supabaseAdmin>;
  bankId?: string;
};

export type FinancialSnapshotValidation = {
  snapshot: StoredFinancialSnapshot | null;
  completenessPercent: number | null;
  missingRequiredKeys: string[];
  gate: FinancialSnapshotGate;
};

/** One read/evaluation contract for the validation API, workbench and lifecycle. */
export async function loadFinancialSnapshotValidation(
  dealId: string,
  options: FinancialSnapshotGateOptions = {},
): Promise<FinancialSnapshotValidation> {
  try {
    const sb = options.client ?? supabaseAdmin();
    let snapshotQuery = sb.from("financial_snapshots")
      .select("id, snapshot_json, snapshot_hash, created_at")
      .eq("deal_id", dealId);
    if (options.bankId) snapshotQuery = snapshotQuery.eq("bank_id", options.bankId);
    const { data, error } = await snapshotQuery
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(1).maybeSingle();
    if (error) throw new Error(`financial_snapshots query failed: ${error.message}`);
    const snapshot = data as StoredFinancialSnapshot | null;

    let gapQuery = sb.from("deal_gap_queue").select("gap_type")
      .eq("deal_id", dealId).eq("status", "open");
    if (options.bankId) gapQuery = gapQuery.eq("bank_id", options.bankId);
    const { data: gaps, error: gapsError } = await gapQuery;
    if (gapsError) throw new Error(`deal_gap_queue query failed: ${gapsError.message}`);

    let stale = false;
    if (snapshot) {
      const facts = await loadSnapshotFactInputs(sb, dealId, options.bankId);
      // Older snapshots lack an input fingerprint and require one real rebuild.
      stale = !snapshot.snapshot_json?.input_facts_hash
        || snapshot.snapshot_json.input_facts_hash !== financialFactFingerprint(facts ?? []);
    }

    const body = snapshot?.snapshot_json;
    const completeness = body?.completeness_pct;
    const completenessPercent = typeof completeness === "number" && Number.isFinite(completeness)
      && completeness >= 0 && completeness <= 100 ? completeness : null;
    const missingRequiredKeys = Array.isArray(body?.missing_required_keys)
      ? body.missing_required_keys.filter((key): key is string => typeof key === "string") : [];
    const hasValidMissingList = Array.isArray(body?.missing_required_keys)
      && body.missing_required_keys.every(key => typeof key === "string");
    const complete = completenessPercent === 100 && hasValidMissingList && missingRequiredKeys.length === 0;
    const openReviewItems = (gaps ?? []).length;
    const unresolvedConflicts = (gaps ?? []).filter(g => g.gap_type === "conflict").length;
    const unresolvedMissingFacts = (gaps ?? []).filter(g => g.gap_type === "missing_fact").length;
    const builtAt = snapshot ? Date.parse(snapshot.created_at) : NaN;
    const evidence: FinancialSnapshotEvidence = {
      snapshotExists: Boolean(snapshot),
      snapshotAgeHours: Number.isFinite(builtAt) ? Math.max(0, Math.round((Date.now() - builtAt) / 3600000)) : null,
      openReviewItems,
      unresolvedConflicts,
      unresolvedMissingFacts,
      unresolvedLowConfidenceFacts: (gaps ?? []).filter(g => g.gap_type === "low_confidence").length,
      lastBuiltAt: snapshot?.created_at ?? null,
      lastBuildStatus: snapshot ? (stale ? "stale" : complete ? "validated" : "needs_review") : null,
    };
    let blockerCode: Extract<FinancialSnapshotGate, { evaluationStatus: "evaluated" }>["blockerCode"] = null;
    let message: string | null = null;
    if (!snapshot) {
      blockerCode = "financial_snapshot_missing";
      message = "No financial snapshot exists — rebuild the snapshot after supplying financial evidence";
    } else if (stale) {
      blockerCode = "financial_snapshot_stale";
      message = "Financial evidence has changed or needs to be revalidated — rebuild the snapshot";
    } else if (!complete || unresolvedConflicts + unresolvedMissingFacts > 0) {
      blockerCode = "financial_validation_open";
      message = "Financial snapshot is incomplete or has unresolved validation items — review the evidence and rebuild";
    }
    return {
      snapshot, completenessPercent, missingRequiredKeys,
      gate: { evaluationStatus: "evaluated", ready: blockerCode === null, blockerCode, message, evidence },
    };
  } catch (err) {
    console.error("[getFinancialSnapshotGate] Error (fail-closed)", {
      dealId, error: err instanceof Error ? err.message : String(err),
    });
    return {
      snapshot: null, completenessPercent: null, missingRequiredKeys: [],
      gate: {
        evaluationStatus: "unavailable", ready: false, blockerCode: "financial_validation_unavailable",
        message: "Financial validation is temporarily unavailable — retry before proceeding", evidence: null,
      },
    };
  }
}

/** Never throws or grants readiness when the shared evaluation is unavailable. */
export async function getFinancialSnapshotGate(
  dealId: string,
  options: FinancialSnapshotGateOptions = {},
): Promise<FinancialSnapshotGate> {
  return (await loadFinancialSnapshotValidation(dealId, options)).gate;
}
