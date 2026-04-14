import "server-only";

/**
 * Underwrite Trust Layer Builder
 *
 * Composes existing canonical sources into a normalized trust-layer payload:
 *   1. Memo freshness — from memoProvenance (pure) + canonical_memo_narratives table
 *   2. Packet readiness — from packetPreflight + canonical_memo_narratives presence
 *   3. Financial validation — from buildCommitteeFinancialValidationSummary
 *
 * NO new provenance/status logic introduced.
 * This is a read-only composition of existing canonical systems.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeMemoInputHash, checkMemoStaleness } from "@/lib/creditMemo/canonical/memoProvenance";
import { fetchMemoHashInputs } from "@/lib/creditMemo/canonical/fetchMemoHashInputs";
import { buildCommitteeFinancialValidationSummary } from "@/lib/financialValidation/buildCommitteeFinancialValidationSummary";
import { runPacketPreflight } from "@/lib/financialValidation/packetPreflight";

// ── Trust Layer Types ──────────────────────────────────────────────────────

export type TrustLayerMemo = {
  status: "fresh" | "stale" | "missing" | "failed";
  staleReasons: string[];
  lastGeneratedAt: string | null;
  inputHash: string | null;
  snapshotId: string | null;
};

export type TrustLayerPacket = {
  status: "ready" | "warning" | "blocked" | "missing";
  warnings: string[];
  blockers: string[];
  lastGeneratedAt: string | null;
  financialValidationStatus: string | null;
  hasCanonicalMemoNarrative: boolean;
};

export type TrustLayerFinancialValidation = {
  memoSafe: boolean;
  decisionSafe: boolean;
  blockers: string[];
  warnings: string[];
  snapshotId: string | null;
};

export type TrustLayer = {
  memo: TrustLayerMemo;
  packet: TrustLayerPacket;
  financialValidation: TrustLayerFinancialValidation;
};

// ── Builder ──────────────────────────────────────────────────────────────

/**
 * Build the trust layer for a deal. All sources are canonical — no re-implementation.
 * Degrades safely on missing data (returns explicit Missing/Warning states).
 */
export async function buildTrustLayer(dealId: string): Promise<TrustLayer> {
  const [memo, packet, financialValidation] = await Promise.all([
    buildMemoTrust(dealId),
    buildPacketTrust(dealId),
    buildFinancialValidationTrust(dealId),
  ]);

  return { memo, packet, financialValidation };
}

// ── Memo Freshness ──────────────────────────────────────────────────────

async function buildMemoTrust(dealId: string): Promise<TrustLayerMemo> {
  try {
    const sb = supabaseAdmin();

    // Use canonical memo hash input assembly — same queries as memo generation route
    const [hashInputs, memoRes] = await Promise.all([
      fetchMemoHashInputs(sb, dealId),

      sb.from("canonical_memo_narratives")
        .select("input_hash, generated_at")
        .eq("deal_id", dealId)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const snapshotId = hashInputs.snapshotId;

    // If no snapshot exists, memo can't be generated yet
    if (!snapshotId) {
      return {
        status: "missing",
        staleReasons: ["No financial snapshot exists"],
        lastGeneratedAt: null,
        inputHash: null,
        snapshotId: null,
      };
    }

    // Compute current input hash using canonical provenance function + canonical inputs
    const currentHash = computeMemoInputHash(hashInputs);

    const memoHash = memoRes.data?.input_hash ?? null;
    const lastGeneratedAt = memoRes.data?.generated_at ?? null;

    if (!memoHash) {
      return {
        status: "missing",
        staleReasons: ["No memo has been generated yet"],
        lastGeneratedAt: null,
        inputHash: currentHash,
        snapshotId,
      };
    }

    // Use canonical staleness check — no re-implementation
    const staleness = checkMemoStaleness(currentHash, memoHash);

    return {
      status: staleness.stale ? "stale" : "fresh",
      staleReasons: staleness.reasons,
      lastGeneratedAt,
      inputHash: currentHash,
      snapshotId,
    };
  } catch (err) {
    console.warn("[buildTrustLayer] memo trust failed:", err);
    return {
      status: "failed",
      staleReasons: ["Could not compute memo freshness"],
      lastGeneratedAt: null,
      inputHash: null,
      snapshotId: null,
    };
  }
}

// ── Packet Readiness ────────────────────────────────────────────────────

async function buildPacketTrust(dealId: string): Promise<TrustLayerPacket> {
  try {
    const sb = supabaseAdmin();

    // Run canonical preflight (draft mode — more permissive, surfaces all warnings)
    const [preflight, narrativeRes, packetEventRes] = await Promise.all([
      runPacketPreflight(dealId, "draft"),

      // Check canonical memo narrative presence
      sb.from("canonical_memo_narratives")
        .select("id")
        .eq("deal_id", dealId)
        .limit(1)
        .maybeSingle(),

      // Latest packet generation event — canonical domain event from packet generation route
      sb.from("deal_events")
        .select("created_at")
        .eq("deal_id", dealId)
        .eq("kind", "deal.committee.packet.generated")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const hasNarrative = !!narrativeRes.data;
    const lastGeneratedAt = (packetEventRes.data as any)?.created_at ?? null;

    // Derive packet status from preflight result
    let status: TrustLayerPacket["status"];
    if (preflight.blockers.length > 0) {
      status = "blocked";
    } else if (preflight.warnings.length > 0) {
      status = "warning";
    } else if (!hasNarrative) {
      status = "missing";
    } else {
      status = "ready";
    }

    return {
      status,
      warnings: preflight.warnings,
      blockers: preflight.blockers,
      lastGeneratedAt,
      financialValidationStatus: preflight.financialValidation.status,
      hasCanonicalMemoNarrative: hasNarrative,
    };
  } catch (err) {
    console.warn("[buildTrustLayer] packet trust failed:", err);
    return {
      status: "missing",
      warnings: [],
      blockers: ["Could not compute packet readiness"],
      lastGeneratedAt: null,
      financialValidationStatus: null,
      hasCanonicalMemoNarrative: false,
    };
  }
}

// ── Financial Validation ────────────────────────────────────────────────

async function buildFinancialValidationTrust(dealId: string): Promise<TrustLayerFinancialValidation> {
  try {
    const sb = supabaseAdmin();

    // Use canonical committee validation summary — no re-implementation
    // NOTE: financial_snapshots_v2.is_active does not exist — use financial_snapshots instead
    const [summary, snapshotRes] = await Promise.all([
      buildCommitteeFinancialValidationSummary(dealId),

      sb.from("financial_snapshots")
        .select("id")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const blockers: string[] = [];
    const warnings: string[] = [];

    if (summary.criticalMissingCount > 0) {
      blockers.push(`${summary.criticalMissingCount} critical metric(s) missing`);
    }
    if (summary.unresolvedConflictCount > 0) {
      blockers.push(`${summary.unresolvedConflictCount} unresolved conflict(s)`);
    }
    if (summary.staleReasons.length > 0) {
      warnings.push(...summary.staleReasons);
    }
    if (summary.openFollowUpCount > 0) {
      warnings.push(`${summary.openFollowUpCount} low-confidence item(s) need review`);
    }

    return {
      memoSafe: summary.memoSafe,
      decisionSafe: summary.decisionSafe,
      blockers,
      warnings,
      snapshotId: snapshotRes.data?.id ?? null,
    };
  } catch (err) {
    console.warn("[buildTrustLayer] financial validation trust failed:", err);
    return {
      memoSafe: false,
      decisionSafe: false,
      blockers: ["Could not compute financial validation state"],
      warnings: [],
      snapshotId: null,
    };
  }
}
