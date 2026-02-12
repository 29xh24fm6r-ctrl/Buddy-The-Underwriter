/**
 * GET /api/deals/[dealId]/lifecycle
 *
 * Returns the current lifecycle state for a deal.
 * This is the single source of truth for "where is this deal and what's blocking it?"
 *
 * CONTRACT: This endpoint NEVER returns HTTP 500.
 * - All errors are represented as { ok: false, state: LifecycleState with blockers }
 * - Always returns HTTP 200 with JSON body
 * - Response always includes x-correlation-id and x-buddy-route headers
 * - Errors are diagnosable via correlationId in response + server logs
 *
 * RESPONSE BOUNDARY SEALED: All payload building happens before respond200().
 */
import "server-only";

import { NextRequest } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { deriveLifecycleState } from "@/buddy/lifecycle";
import { sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";
import type { LifecycleState } from "@/buddy/lifecycle";
import { trackDegradedResponse } from "@/lib/api/degradedTracker";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  validateUuidParam,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/deals/[dealId]/lifecycle";

type Params = Promise<{ dealId: string }>;

/**
 * Create a fallback error state that is always valid.
 * This ensures we NEVER return 500 - we always return a valid LifecycleState.
 */
function createFallbackState(
  dealId: string,
  correlationId: string,
  errorSummary: string,
  errorCode: string = "route_error"
): LifecycleState {
  return {
    stage: "intake_created",
    lastAdvancedAt: null,
    blockers: [
      {
        code: errorCode as LifecycleState["blockers"][0]["code"],
        message: errorSummary,
        evidence: {
          correlationId,
          dealId,
          source: "lifecycle_route",
          timestamp: new Date().toISOString(),
        },
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
      pricingQuoteReady: false,
      riskPricingFinalized: false,
      attestationSatisfied: true,
      aiPipelineComplete: true,
      spreadsComplete: true,
      structuralPricingReady: false,
      hasPricingAssumptions: false,
      hasSubmittedLoanRequest: false,
      correlationId,
    },
  };
}

/**
 * Build the response payload. All business logic happens here.
 * Returns a plain JS object ready for serialization.
 */
async function buildPayload(
  ctx: { params: Params },
  correlationId: string
): Promise<{ ok: boolean; state: LifecycleState; _dealId: string }> {
  let dealId = "unknown";

  try {
    // === Phase 1: Extract and validate dealId ===
    let rawDealId: string;
    try {
      const params = await ctx.params;
      rawDealId = params.dealId;
    } catch {
      console.error(`[lifecycle] correlationId=${correlationId} dealId=unknown source=params error=failed_to_extract_params`);
      return {
        ok: false,
        state: createFallbackState("unknown", correlationId, "Failed to extract request parameters", "params_error"),
        _dealId: "unknown",
      };
    }

    const validation = validateUuidParam(rawDealId, "dealId");
    if (!validation.ok) {
      console.warn(`[lifecycle] correlationId=${correlationId} dealId=${rawDealId} source=validation error=${validation.error}`);
      return {
        ok: false,
        state: createFallbackState(rawDealId || "invalid", correlationId, validation.error, "validation_error"),
        _dealId: rawDealId || "invalid",
      };
    }
    dealId = validation.value;

    // === Phase 2: Verify deal access ===
    let access: { ok: boolean; error?: string; bankId?: string };
    try {
      access = await ensureDealBankAccess(dealId);
    } catch (accessErr) {
      const errInfo = sanitizeErrorForEvidence(accessErr);
      console.error(`[lifecycle] correlationId=${correlationId} dealId=${dealId} source=access error=${errInfo.message}`);
      return {
        ok: false,
        state: createFallbackState(dealId, correlationId, "Failed to verify deal access", "access_error"),
        _dealId: dealId,
      };
    }

    if (!access.ok) {
      const errorCode = access.error === "deal_not_found" ? "deal_not_found" : "access_denied";
      console.warn(`[lifecycle] correlationId=${correlationId} dealId=${dealId} source=access error=${access.error}`);
      return {
        ok: false,
        state: createFallbackState(dealId, correlationId, access.error || "Access denied", errorCode),
        _dealId: dealId,
      };
    }

    // === Phase 2.5: Ensure deal_status row exists (self-heal) ===
    // Belt-and-suspenders: DB trigger handles new deals, this catches legacy ones.
    // Must run BEFORE derivation so deriveLifecycleState always finds deal_status.
    try {
      const { bootstrapDealLifecycle } = await import(
        "@/lib/lifecycle/bootstrapDealLifecycle"
      );
      const bootstrap = await bootstrapDealLifecycle(dealId);
      if (bootstrap.created) {
        console.log(`[lifecycle] correlationId=${correlationId} dealId=${dealId} source=bootstrap created=true`);
        // Fire-and-forget ledger event for traceability
        import("@/lib/pipeline/logLedgerEvent").then(({ logLedgerEvent }) =>
          logLedgerEvent({
            dealId,
            bankId: access.bankId ?? "unknown",
            eventKey: "deal.lifecycle.ensure",
            uiState: "done",
            uiMessage: "Lifecycle status row auto-created",
            meta: { correlationId, hadToCreateStatusRow: true },
          }),
        ).catch(() => {});
      }
    } catch {
      // Non-fatal: derivation will still work without deal_status
    }

    // === Phase 3: Derive lifecycle state ===
    let state: LifecycleState;
    try {
      state = await deriveLifecycleState(dealId);
    } catch (deriveErr) {
      const errInfo = sanitizeErrorForEvidence(deriveErr);
      console.error(`[lifecycle] correlationId=${correlationId} dealId=${dealId} source=derive error=${errInfo.message}`);
      return {
        ok: false,
        state: createFallbackState(dealId, correlationId, "Failed to derive lifecycle state", "derive_error"),
        _dealId: dealId,
      };
    }

    // CRITICAL FIX: If ensureDealBankAccess passed (Phase 2), the deal EXISTS.
    // Any "deal_not_found" from derivation is a transient query failure, NOT a
    // real missing deal. Strip it — returning deal_not_found for an existing deal
    // is the root cause of the persistent cockpit blocker.
    const accessConfirmedDealExists = access.ok;
    let sanitizedState = state;

    if (accessConfirmedDealExists && state.blockers.some((b) => b.code === "deal_not_found")) {
      console.warn(
        `[lifecycle] correlationId=${correlationId} dealId=${dealId} ` +
        `source=derive STRIPPING deal_not_found blocker (access check confirmed deal exists)`,
      );

      sanitizedState = {
        ...state,
        blockers: state.blockers.filter((b) => b.code !== "deal_not_found"),
      };
    }

    // Inject correlationId into derived for debugging
    const stateWithCorrelation: LifecycleState = {
      ...sanitizedState,
      derived: {
        ...sanitizedState.derived,
        correlationId,
      },
    };

    // Check for internal errors in blockers (also ok: false)
    const hasInternalError = stateWithCorrelation.blockers.some((b) => b.code === "internal_error");

    return { ok: !hasInternalError, state: stateWithCorrelation, _dealId: dealId };
  } catch (unexpectedErr) {
    const errInfo = sanitizeErrorForEvidence(unexpectedErr);
    console.error(`[lifecycle] correlationId=${correlationId} dealId=${dealId} source=route_handler error=UNEXPECTED: ${errInfo.message}`);
    return {
      ok: false,
      state: createFallbackState(dealId, correlationId, "Unexpected error in lifecycle route", "unexpected_error"),
      _dealId: dealId,
    };
  }
}

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  const correlationId = generateCorrelationId("lc");
  const headers = createHeaders(correlationId, ROUTE);

  // Build payload (all business logic)
  const { ok, state, _dealId } = await buildPayload(ctx, correlationId);

  // Track degraded responses (fire-and-forget, no await)
  if (!ok && state.blockers.length > 0) {
    const firstBlocker = state.blockers[0];
    trackDegradedResponse({
      endpoint: ROUTE,
      code: String(firstBlocker.code),
      message: firstBlocker.message,
      dealId: _dealId,
      correlationId,
    }).catch(() => {}); // Swallow any errors
  }

  // SEALED RESPONSE: Single return point, all serialization handled inside respond200
  return respond200({ ok, state }, headers);
}
