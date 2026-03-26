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

export type FinancialSnapshotGate = {
  ready: boolean;
  blockerCode:
    | "financial_snapshot_missing"
    | "financial_snapshot_stale"
    | "financial_validation_open"
    | "financial_snapshot_build_failed"
    | null;
  message: string | null;
  evidence: {
    snapshotExists: boolean;
    snapshotAgeHours: number | null;
    openReviewItems: number;
    unresolvedConflicts: number;
    unresolvedMissingFacts: number;
    unresolvedLowConfidenceFacts: number;
    lastBuiltAt: string | null;
    lastBuildStatus: string | null;
  };
};

/**
 * Compute financial snapshot gate for a deal.
 * Safe to call from deriveLifecycleState — never throws.
 */
export async function getFinancialSnapshotGate(dealId: string): Promise<FinancialSnapshotGate> {
  const sb = supabaseAdmin();

  try {
    // Load active v2 snapshot
    const { data: v2Snapshot } = await sb
      .from("financial_snapshots_v2")
      .select("id, status, unresolved_conflict_count, missing_fact_count, created_at, updated_at")
      .eq("deal_id", dealId)
      .eq("active", true)
      .maybeSingle();

    // Also check legacy deal_truth_snapshots for backwards compat
    const { count: legacyCount } = await sb
      .from("deal_truth_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    const snapshotExists = Boolean(v2Snapshot) || (legacyCount != null && legacyCount > 0);

    // Count open gap queue items (financial review items)
    const { data: openGaps } = await sb
      .from("deal_gap_queue")
      .select("gap_type")
      .eq("deal_id", dealId)
      .eq("status", "open");

    const gaps = openGaps ?? [];
    const openReviewItems = gaps.length;
    const unresolvedConflicts = gaps.filter((g: any) => g.gap_type === "conflict").length;
    const unresolvedMissingFacts = gaps.filter((g: any) => g.gap_type === "missing_fact").length;
    const unresolvedLowConfidence = gaps.filter((g: any) => g.gap_type === "low_confidence").length;

    const snapshotAgeHours = v2Snapshot?.created_at
      ? Math.round((Date.now() - new Date(v2Snapshot.created_at).getTime()) / 3600000)
      : null;

    const lastBuildStatus = v2Snapshot?.status ?? null;

    const evidence: FinancialSnapshotGate["evidence"] = {
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
        ready: false,
        blockerCode: "financial_snapshot_missing",
        message: "No financial snapshot exists — upload financial documents and generate spreads",
        evidence,
      };
    }

    if (v2Snapshot?.status === "stale") {
      return {
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
        ready: false,
        blockerCode: "financial_validation_open",
        message: `${blockingItems} unresolved financial validation item(s) — open Financial Validation to review`,
        evidence,
      };
    }

    // Ready
    return { ready: true, blockerCode: null, message: null, evidence };
  } catch (err) {
    // Never throw — fail open with a warning
    console.error("[getFinancialSnapshotGate] Error (fail-open)", {
      dealId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ready: true, // fail-open
      blockerCode: null,
      message: null,
      evidence: {
        snapshotExists: false,
        snapshotAgeHours: null,
        openReviewItems: 0,
        unresolvedConflicts: 0,
        unresolvedMissingFacts: 0,
        unresolvedLowConfidenceFacts: 0,
        lastBuiltAt: null,
        lastBuildStatus: null,
      },
    };
  }
}
