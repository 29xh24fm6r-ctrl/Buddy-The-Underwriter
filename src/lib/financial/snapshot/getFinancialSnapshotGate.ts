import "server-only";

/**
 * Phase 55C — Financial Snapshot Gate for Lifecycle / Memo / Decision
 *
 * Returns whether downstream systems can safely proceed based on:
 * - active financial snapshot existence + status
 * - open review items from deal_gap_queue
 * - snapshot freshness
 *
 * Stage-aware: blocks committee readiness, not early underwriting.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FinancialSnapshotStatus } from "./types";

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

/**
 * Compute financial snapshot gate for a deal.
 * Safe to call from deriveLifecycleState — never throws.
 */
type FinancialSnapshotGateOptions = {
  /** Test seam for exercising query failures without a live database. */
  client?: ReturnType<typeof supabaseAdmin>;
};

export async function getFinancialSnapshotGate(
  dealId: string,
  options: FinancialSnapshotGateOptions = {},
): Promise<FinancialSnapshotGate> {
  const sb = options.client ?? supabaseAdmin();

  try {
    // Load active v2 snapshot
    const { data: v2Snapshot, error: v2Error } = await sb
      .from("financial_snapshots_v2")
      .select("id, status, unresolved_conflict_count, missing_fact_count, created_at, updated_at")
      .eq("deal_id", dealId)
      .eq("active", true)
      .maybeSingle();

    if (v2Error) {
      throw new Error(`financial_snapshots_v2 query failed: ${v2Error.message}`);
    }

    // v2 is the target system but the recompute route still writes to v1
    // (financial_snapshots). Fall back to v1 when no v2 row exists so the
    // committee gate doesn't permanently block every deal.
    let snapshotExists = Boolean(v2Snapshot);
    if (!snapshotExists) {
      const { count: v1Count, error: v1Error } = await sb
        .from("financial_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId);
      if (v1Error) {
        throw new Error(`financial_snapshots fallback query failed: ${v1Error.message}`);
      }
      snapshotExists = (v1Count ?? 0) > 0;
    }

    // Count open gap queue items (financial review items)
    const { data: openGaps, error: gapsError } = await sb
      .from("deal_gap_queue")
      .select("gap_type")
      .eq("deal_id", dealId)
      .eq("status", "open");

    if (gapsError) {
      throw new Error(`deal_gap_queue query failed: ${gapsError.message}`);
    }

    const gaps = openGaps ?? [];
    const openReviewItems = gaps.length;
    const unresolvedConflicts = gaps.filter((g: any) => g.gap_type === "conflict").length;
    const unresolvedMissingFacts = gaps.filter((g: any) => g.gap_type === "missing_fact").length;
    const unresolvedLowConfidence = gaps.filter((g: any) => g.gap_type === "low_confidence").length;

    const snapshotAgeHours = v2Snapshot?.created_at
      ? Math.round((Date.now() - new Date(v2Snapshot.created_at).getTime()) / 3600000)
      : null;

    const lastBuildStatus = v2Snapshot?.status ?? null;

    const evidence: FinancialSnapshotEvidence = {
      snapshotExists,
      snapshotAgeHours,
      openReviewItems,
      unresolvedConflicts,
      unresolvedMissingFacts,
      unresolvedLowConfidenceFacts: unresolvedLowConfidence,
      lastBuiltAt: v2Snapshot?.created_at ?? null,
      lastBuildStatus,
    };

    // Determine gate status
    if (!snapshotExists) {
      return {
        evaluationStatus: "evaluated",
        ready: false,
        blockerCode: "financial_snapshot_missing",
        message: "No financial snapshot exists — upload financial documents and generate spreads",
        evidence,
      };
    }

    if (v2Snapshot?.status === "stale") {
      return {
        evaluationStatus: "evaluated",
        ready: false,
        blockerCode: "financial_snapshot_stale",
        message: "Financial snapshot is stale — newer financial evidence exists",
        evidence,
      };
    }

    // Open blocking review items (conflicts + missing facts block; low_confidence is advisory)
    const blockingItems = unresolvedConflicts + unresolvedMissingFacts;
    if (blockingItems > 0) {
      return {
        evaluationStatus: "evaluated",
        ready: false,
        blockerCode: "financial_validation_open",
        message: `${blockingItems} unresolved financial validation item(s) — open Financial Validation to review`,
        evidence,
      };
    }

    // Ready
    return { evaluationStatus: "evaluated", ready: true, blockerCode: null, message: null, evidence };
  } catch (err) {
    // Never throw, but never grant readiness when validation could not run.
    // Evidence is explicitly unavailable rather than synthesized as a clean
    // zero-count result.
    console.error("[getFinancialSnapshotGate] Error (fail-closed)", {
      dealId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      evaluationStatus: "unavailable",
      ready: false,
      blockerCode: "financial_validation_unavailable",
      message: "Financial validation is temporarily unavailable — retry before proceeding",
      evidence: null,
    };
  }
}
