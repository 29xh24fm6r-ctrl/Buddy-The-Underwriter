import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { deriveLifecycleState } from "@/buddy/lifecycle";
import { jsonSafe, sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";
import type { LifecycleState } from "@/buddy/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * Generate a correlation ID for request tracing.
 */
function generateCorrelationId(): string {
  return `lc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
        code: errorCode as any,
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
      attestationSatisfied: true,
      // Include correlation for debugging
      correlationId,
    },
  };
}

/**
 * Validate dealId format without throwing.
 */
function validateDealId(dealId: unknown): { ok: true; dealId: string } | { ok: false; error: string } {
  if (typeof dealId !== "string") {
    return { ok: false, error: "dealId must be a string" };
  }
  if (!dealId || dealId === "undefined" || dealId === "null") {
    return { ok: false, error: "dealId is empty or invalid" };
  }
  // Basic UUID format check (loose - accepts hyphenated UUIDs)
  if (dealId.length < 10 || dealId.length > 50) {
    return { ok: false, error: "dealId has invalid length" };
  }
  return { ok: true, dealId };
}

/**
 * GET /api/deals/[dealId]/lifecycle
 *
 * Returns the current lifecycle state for a deal.
 * This is the single source of truth for "where is this deal and what's blocking it?"
 *
 * CONTRACT: This endpoint NEVER returns HTTP 500.
 * - All errors are represented as { ok: false, state: LifecycleState with blockers }
 * - Always returns HTTP 200 with JSON body
 * - Errors are diagnosable via correlationId in response + server logs
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Params }
): Promise<NextResponse> {
  const correlationId = generateCorrelationId();
  let dealId = "unknown";

  try {
    // === Phase 1: Extract and validate dealId ===
    let rawDealId: string;
    try {
      const params = await ctx.params;
      rawDealId = params.dealId;
    } catch (paramErr) {
      console.error(
        `[lifecycle] correlationId=${correlationId} dealId=unknown source=params error=failed_to_extract_params`,
        paramErr
      );
      return createJsonResponse(
        {
          ok: false,
          state: createFallbackState("unknown", correlationId, "Failed to extract request parameters", "params_error"),
        },
        correlationId
      );
    }

    const validation = validateDealId(rawDealId);
    if (!validation.ok) {
      console.warn(
        `[lifecycle] correlationId=${correlationId} dealId=${rawDealId} source=validation error=${validation.error}`
      );
      return createJsonResponse(
        {
          ok: false,
          state: createFallbackState(rawDealId || "invalid", correlationId, validation.error, "validation_error"),
        },
        correlationId
      );
    }
    dealId = validation.dealId;

    // === Phase 2: Verify deal access ===
    let access: { ok: boolean; error?: string; bankId?: string };
    try {
      access = await ensureDealBankAccess(dealId);
    } catch (accessErr) {
      const errInfo = sanitizeErrorForEvidence(accessErr);
      console.error(
        `[lifecycle] correlationId=${correlationId} dealId=${dealId} source=access error=${errInfo.message}`
      );
      return createJsonResponse(
        {
          ok: false,
          state: createFallbackState(dealId, correlationId, "Failed to verify deal access", "access_error"),
        },
        correlationId
      );
    }

    if (!access.ok) {
      // Access denied is NOT a 500 - it's a valid response with blockers
      const errorCode = access.error === "deal_not_found" ? "deal_not_found" : "access_denied";
      console.warn(
        `[lifecycle] correlationId=${correlationId} dealId=${dealId} source=access error=${access.error}`
      );
      return createJsonResponse(
        {
          ok: false,
          state: createFallbackState(dealId, correlationId, access.error || "Access denied", errorCode),
        },
        correlationId
      );
    }

    // === Phase 3: Derive lifecycle state ===
    let state: LifecycleState;
    try {
      state = await deriveLifecycleState(dealId);
    } catch (deriveErr) {
      const errInfo = sanitizeErrorForEvidence(deriveErr);
      console.error(
        `[lifecycle] correlationId=${correlationId} dealId=${dealId} source=derive error=${errInfo.message}`
      );
      return createJsonResponse(
        {
          ok: false,
          state: createFallbackState(dealId, correlationId, "Failed to derive lifecycle state", "derive_error"),
        },
        correlationId
      );
    }

    // Inject correlationId into derived for debugging
    const stateWithCorrelation: LifecycleState = {
      ...state,
      derived: {
        ...state.derived,
        correlationId,
      },
    };

    // Check if deal wasn't found during derivation (not a 500, but ok: false)
    if (state.blockers.some((b) => b.code === "deal_not_found")) {
      return createJsonResponse(
        {
          ok: false,
          state: stateWithCorrelation,
        },
        correlationId
      );
    }

    // Check for internal errors in blockers (also ok: false)
    const hasInternalError = state.blockers.some((b) => b.code === "internal_error");

    return createJsonResponse(
      {
        ok: !hasInternalError,
        state: stateWithCorrelation,
      },
      correlationId
    );
  } catch (unexpectedErr) {
    // === Ultimate safety net - should never reach here ===
    const errInfo = sanitizeErrorForEvidence(unexpectedErr);
    console.error(
      `[lifecycle] correlationId=${correlationId} dealId=${dealId} source=route_handler error=UNEXPECTED: ${errInfo.message}`
    );
    return createJsonResponse(
      {
        ok: false,
        state: createFallbackState(dealId, correlationId, "Unexpected error in lifecycle route", "unexpected_error"),
      },
      correlationId
    );
  }
}

/**
 * Create a JSON response with:
 * - Status 200 (NEVER 500)
 * - x-correlation-id header
 * - JSON-safe serialization
 */
function createJsonResponse(
  body: { ok: boolean; state: LifecycleState },
  correlationId: string
): NextResponse {
  try {
    // Use jsonSafe to prevent serialization errors (BigInt, circular refs, etc.)
    const safeBody = jsonSafe(body);

    return NextResponse.json(safeBody, {
      status: 200,
      headers: {
        "x-correlation-id": correlationId,
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (serializationErr) {
    // Even serialization failed - return minimal safe response
    console.error(
      `[lifecycle] correlationId=${correlationId} source=serialization error=failed_to_serialize_response`
    );
    return NextResponse.json(
      {
        ok: false,
        state: {
          stage: "intake_created",
          lastAdvancedAt: null,
          blockers: [
            {
              code: "serialization_error",
              message: "Failed to serialize lifecycle response",
              evidence: { correlationId },
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
            correlationId,
          },
        },
      },
      {
        status: 200,
        headers: {
          "x-correlation-id": correlationId,
          "cache-control": "no-store, max-age=0",
        },
      }
    );
  }
}
