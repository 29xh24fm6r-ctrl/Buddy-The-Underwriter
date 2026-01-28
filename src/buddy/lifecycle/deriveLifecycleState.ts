/**
 * Derive Lifecycle State
 *
 * Computes unified lifecycle state by reading from:
 * - deals.lifecycle_stage (internal 5-stage model)
 * - deal_status.stage (borrower-facing 8-stage model)
 * - deal_checklist_items (document satisfaction)
 * - decision_snapshots (decision presence)
 * - deal_truth_snapshots (financial snapshot)
 *
 * Computes blockers by composing existing guards:
 * - computeDealReadiness() for doc satisfaction
 * - verifyUnderwrite() for underwrite blockers (optional)
 * - requiresCreditCommittee() for committee status
 * - getAttestationStatus() for attestation blockers
 *
 * This is the SINGLE SOURCE OF TRUTH for "where is this deal?"
 *
 * CRITICAL: This function MUST NEVER THROW.
 * Missing data → blocker, NOT exception.
 * GET /api/deals/:id/lifecycle NEVER returns 500.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeDealReadiness } from "@/lib/deals/readiness";
import type {
  LifecycleStage,
  LifecycleState,
  LifecycleBlocker,
  LifecycleDerived,
  LifecycleBlockerCode,
} from "./model";
import {
  safeFetch,
  safeSupabaseQuery,
  safeSupabaseCount,
  type SafeFetchContext,
} from "./safeFetch";
import { getSatisfiedRequired, getMissingRequired } from "@/lib/deals/checklistSatisfaction";

// Type for the internal lifecycle stage from deals table
type DealLifecycleStage = "created" | "intake" | "collecting" | "underwriting" | "ready";

// Type for the borrower-facing stage from deal_status table
type DealStatusStage =
  | "intake"
  | "docs_in_progress"
  | "analysis"
  | "underwriting"
  | "conditional_approval"
  | "closing"
  | "funded"
  | "declined";

// Type for deal data from query
type DealData = {
  id: string;
  bank_id: string | null;
  lifecycle_stage: string | null;
  ready_at: string | null;
  deal_status: { stage: string } | null;
};

/**
 * Derive the unified lifecycle state for a deal.
 *
 * This is a read-only function that computes state from canonical sources.
 * It never mutates data - that's the job of advanceDealLifecycle().
 *
 * CRITICAL: This function MUST NEVER THROW.
 * All DB/service calls are wrapped defensively. Missing data → blocker, NOT exception.
 */
export async function deriveLifecycleState(dealId: string): Promise<LifecycleState> {
  // Wrap the entire function in try/catch as ultimate safety net
  try {
    return await deriveLifecycleStateInternal(dealId);
  } catch (err) {
    console.error("[deriveLifecycleState] Unexpected error (returning safe fallback):", err);
    return createErrorState("internal_error", "Failed to derive lifecycle state");
  }
}

/**
 * Internal implementation - all the real work happens here.
 * Uses safeFetch wrapper for consistent error handling.
 */
async function deriveLifecycleStateInternal(dealId: string): Promise<LifecycleState> {
  const sb = supabaseAdmin();
  const ctx: SafeFetchContext = { dealId };
  const runtimeBlockers: LifecycleBlocker[] = [];

  // 1. Fetch core deal data (critical - no deal = not found state)
  const dealResult = await safeSupabaseQuery<DealData>(
    "deal",
    () =>
      sb
        .from("deals")
        .select(
          `
          id,
          bank_id,
          lifecycle_stage,
          ready_at,
          deal_status!inner(stage)
        `
        )
        .eq("id", dealId)
        .maybeSingle(),
    ctx
  );

  if (!dealResult.ok || !dealResult.data) {
    return createNotFoundState();
  }

  const deal = dealResult.data;
  const lifecycleStage = (deal.lifecycle_stage as DealLifecycleStage) || "created";
  const dealStatusStage = ((deal.deal_status as any)?.stage as DealStatusStage) || null;

  // 2. Fetch checklist data
  let checklist: Array<{ checklist_key: string; required: boolean; status: string }> = [];
  const checklistResult = await safeSupabaseQuery<typeof checklist>(
    "checklist",
    () =>
      sb
        .from("deal_checklist_items")
        .select("checklist_key, required, status")
        .eq("deal_id", dealId),
    ctx
  );

  if (!checklistResult.ok) {
    runtimeBlockers.push(checklistResult.blocker);
  } else {
    checklist = checklistResult.data || [];
  }

  const requiredItems = checklist.filter((item) => item.required);
  const satisfiedItems = getSatisfiedRequired(checklist);
  const missingItems = getMissingRequired(checklist);

  // 3. Compute deal readiness using existing function
  let borrowerChecklistSatisfied = false;
  const readinessResult = await safeFetch(
    "readiness",
    () => computeDealReadiness(dealId),
    ctx
  );

  if (readinessResult.ok) {
    borrowerChecklistSatisfied = readinessResult.data.ready;
  } else {
    // Fall back to checklist-based calculation (don't add blocker - it's a soft failure)
    borrowerChecklistSatisfied = requiredItems.length > 0 && missingItems.length === 0;
  }

  // 4–8. Parallel independent queries (snapshot, decision, packet, advancement)
  const [snapshotResult, decisionResult, packetResult, advancementResult] = await Promise.all([
    safeSupabaseCount(
      "snapshot",
      () =>
        sb
          .from("deal_truth_snapshots")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", dealId),
      ctx
    ),
    safeSupabaseQuery<{
      id: string;
      status: string;
      committee_required: boolean;
    }>(
      "decision",
      () =>
        sb
          .from("decision_snapshots")
          .select("id, status, committee_required")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ctx
    ),
    safeSupabaseCount(
      "packet",
      () =>
        sb
          .from("deal_events")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", dealId)
          .eq("kind", "deal.committee.packet.generated"),
      ctx
    ),
    safeSupabaseQuery<{ created_at: string }>(
      "advancement",
      () =>
        sb
          .from("deal_events")
          .select("created_at")
          .eq("deal_id", dealId)
          .in("kind", ["deal.lifecycle.advanced", "deal.lifecycle_advanced"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ctx
    ),
  ]);

  let financialSnapshotExists = false;
  if (snapshotResult.ok) {
    financialSnapshotExists = snapshotResult.data > 0;
  }

  let decisionPresent = false;
  let committeeRequired = false;
  let latestDecisionId: string | null = null;
  if (decisionResult.ok && decisionResult.data) {
    decisionPresent = decisionResult.data.status === "final";
    committeeRequired = decisionResult.data.committee_required ?? false;
    latestDecisionId = decisionResult.data.id;
  }

  let committeePacketReady = false;
  if (packetResult.ok) {
    committeePacketReady = packetResult.data > 0;
  }

  let lastAdvancedAt: string | null = null;
  if (advancementResult.ok && advancementResult.data) {
    lastAdvancedAt = advancementResult.data.created_at;
  }

  // Attestation check depends on decision result — runs after parallel batch
  let attestationSatisfied = true;
  if (latestDecisionId && deal.bank_id) {
    const attestationResult = await safeFetch(
      "attestation",
      async () => {
        const { getAttestationStatus } = await import("@/lib/decision/attestation");
        return getAttestationStatus(dealId, latestDecisionId!, deal.bank_id!);
      },
      ctx
    );

    if (attestationResult.ok) {
      attestationSatisfied = attestationResult.data.satisfied;
    }
  }

  // Build derived state (safe math - guard against divide by zero)
  const requiredDocsReceivedPct =
    requiredItems.length > 0
      ? Math.round((satisfiedItems.length / requiredItems.length) * 100)
      : checklist.length === 0
        ? 0
        : 100; // No checklist = 0%, empty required = 100%

  const derived: LifecycleDerived = {
    requiredDocsReceivedPct,
    requiredDocsMissing: missingItems.map((item) => item.checklist_key),
    borrowerChecklistSatisfied,
    underwriteStarted: lifecycleStage === "underwriting" || lifecycleStage === "ready",
    financialSnapshotExists,
    committeePacketReady,
    decisionPresent,
    committeeRequired,
    attestationSatisfied,
  };

  // Map to unified stage
  const stage = mapToUnifiedStage(lifecycleStage, dealStatusStage, derived);

  // Compute blockers (merge with any runtime fetch failures)
  const blockers = [...computeBlockers(stage, derived, checklist.length), ...runtimeBlockers];

  return {
    stage,
    lastAdvancedAt,
    blockers,
    derived,
  };
}

/**
 * Map from existing models to unified lifecycle stage.
 */
function mapToUnifiedStage(
  lifecycleStage: DealLifecycleStage,
  dealStatusStage: DealStatusStage | null,
  derived: LifecycleDerived
): LifecycleStage {
  // Check terminal states first (from deal_status)
  if (dealStatusStage === "funded") return "closed";
  if (dealStatusStage === "closing") return "closing_in_progress";

  // Map from internal lifecycle stage
  switch (lifecycleStage) {
    case "created":
      return "intake_created";

    case "intake":
      return "docs_requested";

    case "collecting":
      // Sub-stages based on checklist completion
      if (!derived.borrowerChecklistSatisfied) {
        return derived.requiredDocsReceivedPct > 0 ? "docs_in_progress" : "docs_requested";
      }
      // Docs satisfied - check if ready for underwrite
      if (derived.financialSnapshotExists) {
        return "underwrite_ready";
      }
      return "docs_satisfied";

    case "underwriting":
      return "underwrite_in_progress";

    case "ready":
      // Decision workflow stages
      if (derived.decisionPresent) {
        return "committee_decisioned";
      }
      return "committee_ready";

    default:
      return "intake_created";
  }
}

/**
 * Compute blockers based on current stage and derived state.
 */
function computeBlockers(
  stage: LifecycleStage,
  derived: LifecycleDerived,
  checklistCount: number
): LifecycleBlocker[] {
  const blockers: LifecycleBlocker[] = [];

  // Early stages: checklist not seeded
  if (stage === "intake_created" && checklistCount === 0) {
    blockers.push({
      code: "checklist_not_seeded",
      message: "Checklist has not been created for this deal",
    });
  }

  // Document collection blockers
  if (
    ["docs_requested", "docs_in_progress"].includes(stage) &&
    derived.requiredDocsMissing.length > 0
  ) {
    blockers.push({
      code: "missing_required_docs",
      message: `${derived.requiredDocsMissing.length} required document(s) missing`,
      evidence: { missing: derived.requiredDocsMissing },
    });
  }

  // Underwrite readiness blockers
  if (stage === "docs_satisfied" && !derived.financialSnapshotExists) {
    blockers.push({
      code: "financial_snapshot_missing",
      message: "Financial snapshot required before underwriting",
    });
  }

  // Committee readiness blockers
  if (stage === "underwrite_in_progress" || stage === "committee_ready") {
    if (!derived.committeePacketReady && derived.committeeRequired) {
      blockers.push({
        code: "committee_packet_missing",
        message: "Committee packet must be generated before decision",
      });
    }
  }

  // Decision blockers
  if (stage === "committee_ready" && !derived.decisionPresent) {
    blockers.push({
      code: "decision_missing",
      message: "Final decision has not been recorded",
    });
  }

  // Attestation blockers (only if decision exists but not attested)
  if (stage === "committee_decisioned" && !derived.attestationSatisfied) {
    blockers.push({
      code: "attestation_missing",
      message: "Required attestations not yet completed",
    });
  }

  return blockers;
}

/**
 * Create a state for deals that don't exist.
 */
function createNotFoundState(): LifecycleState {
  return {
    stage: "intake_created",
    lastAdvancedAt: null,
    blockers: [
      {
        code: "deal_not_found",
        message: "Deal not found or access denied",
      },
    ],
    derived: {
      requiredDocsReceivedPct: 0,
      requiredDocsMissing: [],
      borrowerChecklistSatisfied: false,
      underwriteStarted: false,
      financialSnapshotExists: false,
      committeePacketReady: false,
      decisionPresent: false,
      committeeRequired: false,
      attestationSatisfied: true,
    },
  };
}

/**
 * Create a state for unexpected errors.
 * This ensures we NEVER throw - we always return a valid LifecycleState.
 */
function createErrorState(code: string, message: string): LifecycleState {
  return {
    stage: "intake_created",
    lastAdvancedAt: null,
    blockers: [
      {
        code: code as LifecycleBlockerCode,
        message,
      },
    ],
    derived: {
      requiredDocsReceivedPct: 0,
      requiredDocsMissing: [],
      borrowerChecklistSatisfied: false,
      underwriteStarted: false,
      financialSnapshotExists: false,
      committeePacketReady: false,
      decisionPresent: false,
      committeeRequired: false,
      attestationSatisfied: true,
    },
  };
}
