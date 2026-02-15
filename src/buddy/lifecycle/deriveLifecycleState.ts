/**
 * Derive Lifecycle State
 *
 * Computes unified lifecycle state by reading from:
 * - deals.stage (internal 5-stage model)
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
import { isGatekeeperReadinessEnabled, isGatekeeperReadinessBlockingEnabled } from "@/lib/flags/openaiGatekeeper";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { computeBlockers } from "./computeBlockers";

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

// Type for deal data from query (deal_status fetched separately)
type DealData = {
  id: string;
  bank_id: string | null;
  stage: string | null;
  ready_at: string | null;
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
  // NOTE: deal_status is fetched separately to avoid PostgREST join failures
  // when the FK doesn't exist or deal_status has no row for this deal.
  const dealResult = await safeSupabaseQuery<DealData>(
    "deal",
    () =>
      sb
        .from("deals")
        .select("id, bank_id, stage, ready_at")
        .eq("id", dealId)
        .maybeSingle(),
    ctx
  );

  if (!dealResult.ok || !dealResult.data) {
    return createNotFoundState();
  }

  const deal = dealResult.data;
  const lifecycleStage = (deal.stage as DealLifecycleStage) || "created";

  // Fetch deal_status separately — missing row or missing table is NOT a blocker.
  // If missing but deal exists, bootstrap it defensively (self-heal).
  let dealStatusStage: DealStatusStage | null = null;
  try {
    const { data: statusRow } = await sb
      .from("deal_status")
      .select("stage")
      .eq("deal_id", dealId)
      .maybeSingle();
    dealStatusStage = (statusRow?.stage as DealStatusStage) || null;

    // Self-heal: if deal exists but deal_status is missing, bootstrap it
    if (!statusRow) {
      try {
        const { bootstrapDealLifecycle } = await import(
          "@/lib/lifecycle/bootstrapDealLifecycle"
        );
        const bootstrap = await bootstrapDealLifecycle(dealId);
        if (bootstrap.created) {
          dealStatusStage = "intake";
        }
      } catch {
        // Bootstrap failure is non-fatal — lifecycle still works without deal_status
      }
    }
  } catch {
    // deal_status table missing or query failed — not a blocker
  }

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

  // 3–11. Parallel independent queries (snapshot, decision, packet, advancement, loan requests, pricing, ai pipeline, spreads)
  const [snapshotResult, decisionResult, packetResult, advancementResult, loanRequestResult, pricingResult, legacyPricingResult, aiPipelineResult, spreadsResult, riskPricingResult, structuralPricingResult, pricingInputsResult, researchResult] = await Promise.all([
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
    safeSupabaseQuery<Array<{ id: string; status: string; requested_amount: number | null }>>(
      "loan_requests",
      () =>
        sb
          .from("deal_loan_requests")
          .select("id, status, requested_amount")
          .eq("deal_id", dealId),
      ctx
    ),
    // Pricing decision (authoritative pipeline gate)
    safeSupabaseCount(
      "pricing",
      () =>
        sb
          .from("pricing_decisions")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", dealId),
      ctx
    ),
    // Legacy locked pricing quote (fallback — deal_pricing_quotes calculator)
    safeSupabaseCount(
      "pricing",
      () =>
        sb
          .from("deal_pricing_quotes")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", dealId)
          .eq("status", "locked"),
      ctx
    ),
    // AI pipeline completeness — count artifacts still queued/processing/failed
    safeSupabaseCount(
      "ai_pipeline",
      () =>
        sb
          .from("document_artifacts")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", dealId)
          .in("status", ["queued", "processing", "failed"]),
      ctx
    ),
    // Spread pipeline completeness — count jobs still QUEUED/RUNNING/FAILED
    safeSupabaseCount(
      "spreads",
      () =>
        sb
          .from("deal_spread_jobs")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", dealId)
          .in("status", ["QUEUED", "RUNNING", "FAILED"]),
      ctx
    ),
    // Risk pricing finalization check
    safeSupabaseQuery<{ finalized: boolean }>(
      "risk_pricing",
      () =>
        sb
          .from("deal_risk_pricing_model")
          .select("finalized")
          .eq("deal_id", dealId)
          .maybeSingle(),
      ctx
    ),
    // Structural pricing existence check
    safeSupabaseCount(
      "structural_pricing",
      () =>
        sb
          .from("deal_structural_pricing")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", dealId),
      ctx
    ),
    // Pricing assumptions existence check (deal_pricing_inputs row)
    safeSupabaseCount(
      "pricing_inputs",
      () =>
        sb
          .from("deal_pricing_inputs")
          .select("deal_id", { count: "exact", head: true })
          .eq("deal_id", dealId),
      ctx
    ),
    // Research pipeline completeness — count missions still queued/running
    safeSupabaseCount(
      "research_missions",
      () =>
        sb
          .from("buddy_research_missions")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", dealId)
          .in("status", ["queued", "running"]),
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

  let loanRequestCount = 0;
  let loanRequestHasIncomplete = false;
  if (loanRequestResult.ok && loanRequestResult.data) {
    const requests = loanRequestResult.data as Array<{ id: string; status: string; requested_amount: number | null }>;
    loanRequestCount = requests.length;
    loanRequestHasIncomplete = requests.some(
      (r) => r.status === "draft" || !r.requested_amount,
    );
  }

  let pricingQuoteReady = false;
  if (pricingResult.ok && pricingResult.data > 0) {
    pricingQuoteReady = true;
  } else if (legacyPricingResult.ok && legacyPricingResult.data > 0) {
    // Fallback: legacy deal_pricing_quotes with status=locked
    pricingQuoteReady = true;
  }

  let aiPipelineComplete = true;
  if (aiPipelineResult.ok) {
    aiPipelineComplete = aiPipelineResult.data === 0;
  }

  let spreadsComplete = true;
  if (spreadsResult.ok) {
    spreadsComplete = spreadsResult.data === 0;
  }

  let researchComplete = true; // no missions = vacuously complete
  if (researchResult.ok) {
    researchComplete = researchResult.data === 0;
  }

  let riskPricingFinalized = false;
  if (riskPricingResult.ok && riskPricingResult.data) {
    riskPricingFinalized = riskPricingResult.data.finalized === true;
  }

  let structuralPricingReady = false;
  if (structuralPricingResult.ok) {
    structuralPricingReady = structuralPricingResult.data > 0;
  }

  let hasPricingAssumptions = false;
  if (pricingInputsResult.ok) {
    hasPricingAssumptions = pricingInputsResult.data > 0;
  }

  let hasSubmittedLoanRequest = false;
  if (loanRequestResult.ok && loanRequestResult.data) {
    const requests = loanRequestResult.data as Array<{ id: string; status: string; requested_amount: number | null }>;
    hasSubmittedLoanRequest = requests.some(
      (r) => r.status !== "draft" && r.requested_amount != null && r.requested_amount > 0,
    );
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

  // Gatekeeper readiness (informational; optionally blocking under flag)
  let gatekeeperDerived: Partial<Pick<LifecycleDerived,
    'gatekeeperDocsReady' | 'gatekeeperReadinessPct' | 'gatekeeperNeedsReviewCount'
    | 'gatekeeperMissingBtrYears' | 'gatekeeperMissingPtrYears' | 'gatekeeperMissingFinancialStatements'
  >> = {};

  if (isGatekeeperReadinessEnabled()) {
    try {
      const { computeGatekeeperDocReadiness } = await import("@/lib/gatekeeper/readinessServer");
      const readiness = await computeGatekeeperDocReadiness(dealId);
      gatekeeperDerived = {
        gatekeeperDocsReady: readiness.ready,
        gatekeeperReadinessPct: readiness.readinessPct,
        gatekeeperNeedsReviewCount: readiness.needsReviewCount,
        ...(isGatekeeperReadinessBlockingEnabled() && {
          gatekeeperMissingBtrYears: readiness.missing.businessTaxYears,
          gatekeeperMissingPtrYears: readiness.missing.personalTaxYears,
          gatekeeperMissingFinancialStatements: readiness.missing.financialStatementsMissing,
        }),
      };
    } catch {
      // Non-fatal: gatekeeper readiness failure never blocks lifecycle
    }
  }

  // Document readiness — gatekeeper is the sole authority.
  const documentsReady = gatekeeperDerived.gatekeeperDocsReady ?? false;
  const documentsReadinessPct = gatekeeperDerived.gatekeeperReadinessPct ?? 0;

  const derived: LifecycleDerived = {
    documentsReady,
    documentsReadinessPct,
    underwriteStarted: lifecycleStage === "underwriting" || lifecycleStage === "ready",
    financialSnapshotExists,
    committeePacketReady,
    decisionPresent,
    committeeRequired,
    pricingQuoteReady,
    riskPricingFinalized,
    attestationSatisfied,
    aiPipelineComplete,
    spreadsComplete,
    structuralPricingReady,
    hasPricingAssumptions,
    hasSubmittedLoanRequest,
    researchComplete,
    ...gatekeeperDerived,
  };

  // Map to unified stage
  const stage = mapToUnifiedStage(lifecycleStage, dealStatusStage, derived);

  // Compute blockers (merge with any runtime fetch failures)
  const blockers = [
    ...computeBlockers(stage, derived, checklist.length, loanRequestCount, loanRequestHasIncomplete),
    ...runtimeBlockers,
  ];

  // Gatekeeper blocker telemetry — fire-and-forget, always emit when present
  if (deal.bank_id) {
    const gkBlockers = blockers.filter(
      (b) => b.code === "gatekeeper_docs_need_review" || b.code === "gatekeeper_docs_incomplete",
    );
    for (const b of gkBlockers) {
      logLedgerEvent({
        dealId,
        bankId: deal.bank_id,
        eventKey: b.code === "gatekeeper_docs_need_review"
          ? "gatekeeper.readiness.blocker.docs_need_review"
          : "gatekeeper.readiness.blocker.docs_incomplete",
        uiState: "waiting",
        uiMessage: b.message,
        meta: {
          ...(b.evidence ?? {}),
          readinessPct: derived.gatekeeperReadinessPct,
          needsReviewCount: derived.gatekeeperNeedsReviewCount,
        },
      }).catch(() => {});
    }
  }

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
      // Sub-stages based on document readiness (gatekeeper-authoritative)
      if (!derived.documentsReady) {
        return derived.documentsReadinessPct > 0 ? "docs_in_progress" : "docs_requested";
      }
      // Docs satisfied - check if ready for underwrite
      // Requires submitted loan request + pricing assumptions (NOT financial snapshot)
      if (derived.hasSubmittedLoanRequest && derived.hasPricingAssumptions) {
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
      documentsReady: false,
      documentsReadinessPct: 0,
      underwriteStarted: false,
      financialSnapshotExists: false,
      committeePacketReady: false,
      decisionPresent: false,
      committeeRequired: false,
      pricingQuoteReady: false,
      riskPricingFinalized: false,
      attestationSatisfied: true,
      aiPipelineComplete: true,
      spreadsComplete: true,
      structuralPricingReady: false,
      hasPricingAssumptions: false,
      hasSubmittedLoanRequest: false,
      researchComplete: true,
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
      documentsReady: false,
      documentsReadinessPct: 0,
      underwriteStarted: false,
      financialSnapshotExists: false,
      committeePacketReady: false,
      decisionPresent: false,
      committeeRequired: false,
      pricingQuoteReady: false,
      riskPricingFinalized: false,
      attestationSatisfied: true,
      aiPipelineComplete: true,
      spreadsComplete: true,
      structuralPricingReady: false,
      hasPricingAssumptions: false,
      hasSubmittedLoanRequest: false,
      researchComplete: true,
    },
  };
}
