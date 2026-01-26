/**
 * GET /api/deals/[dealId]
 *
 * Returns the deal object with bank info.
 *
 * CONTRACT: This endpoint NEVER returns HTTP 500.
 * - Always returns HTTP 200 with JSON body
 * - All errors are represented as { ok: false, deal: <fallback>, error: { code, message, correlationId } }
 * - Response always includes x-correlation-id and x-buddy-route headers
 * - Response always includes meta.correlationId for client-side debugging
 *
 * RESPONSE BOUNDARY SEALED: All payload building happens before respond200().
 */
import "server-only";

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  safeWithTimeout,
  validateUuidParam,
} from "@/lib/api/respond";
import { sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";
import { trackDegradedResponse } from "@/lib/api/degradedTracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/deals/[dealId]";

/**
 * Fallback deal shape when data cannot be loaded.
 * Matches minimum required fields so UI never crashes.
 */
function createFallbackDeal(dealId: string): Record<string, unknown> {
  return {
    id: dealId,
    name: "Unknown deal",
    bank_id: null,
    bank: null,
    borrower_name: null,
    created_at: null,
    status: "unknown",
  };
}

/**
 * Build the response payload. All business logic happens here.
 * Returns a plain JS object ready for serialization.
 */
async function buildPayload(
  ctx: { params: Promise<{ dealId: string }> },
  correlationId: string,
  ts: string
): Promise<{
  ok: boolean;
  deal: Record<string, unknown>;
  error?: { code: string; message: string };
  meta: { dealId: string; correlationId: string; ts: string };
}> {
  let dealId = "unknown";

  try {
    // === Phase 1: Extract and validate dealId ===
    let rawDealId: string;
    try {
      const params = await ctx.params;
      rawDealId = params.dealId;
    } catch {
      console.warn(`[deal-route] correlationId=${correlationId} error=failed_to_extract_params`);
      return {
        ok: false,
        deal: createFallbackDeal("unknown"),
        error: { code: "params_error", message: "Failed to extract request parameters" },
        meta: { dealId: "unknown", correlationId, ts },
      };
    }

    const validation = validateUuidParam(rawDealId, "dealId");
    if (!validation.ok) {
      console.warn(`[deal-route] correlationId=${correlationId} dealId=${rawDealId ?? "null"} error=${validation.error}`);
      return {
        ok: false,
        deal: createFallbackDeal(rawDealId ?? "invalid"),
        error: { code: "bad_request", message: validation.error },
        meta: { dealId: rawDealId ?? "invalid", correlationId, ts },
      };
    }
    dealId = validation.value;

    // === Phase 2: Load deal with bank info ===
    const supabase = supabaseAdmin();

    const dealResult = await safeWithTimeout(
      supabase
        .from("deals")
        .select(`*, bank:banks(id, code, name)`)
        .eq("id", dealId)
        .maybeSingle(),
      10_000,
      "dealLoad",
      correlationId
    );

    if (!dealResult.ok) {
      console.warn(`[deal-route] correlationId=${correlationId} dealId=${dealId} error=load_timeout_or_error`);
      return {
        ok: false,
        deal: createFallbackDeal(dealId),
        error: { code: "deal_load_failed", message: dealResult.error },
        meta: { dealId, correlationId, ts },
      };
    }

    const { data: deal, error: dealErr } = dealResult.data;

    if (dealErr) {
      console.warn(`[deal-route] correlationId=${correlationId} dealId=${dealId} error=supabase_error msg=${dealErr.message}`);
      return {
        ok: false,
        deal: createFallbackDeal(dealId),
        error: { code: "deal_query_error", message: dealErr.message },
        meta: { dealId, correlationId, ts },
      };
    }

    if (!deal) {
      console.warn(`[deal-route] correlationId=${correlationId} dealId=${dealId} error=not_found`);
      return {
        ok: false,
        deal: createFallbackDeal(dealId),
        error: { code: "deal_not_found", message: "Deal not found" },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Success ===
    return {
      ok: true,
      deal: deal as Record<string, unknown>,
      meta: { dealId, correlationId, ts },
    };
  } catch (unexpectedErr) {
    const errInfo = sanitizeErrorForEvidence(unexpectedErr);
    console.error(`[deal-route] correlationId=${correlationId} dealId=${dealId} UNEXPECTED: ${errInfo.message}`);
    return {
      ok: false,
      deal: createFallbackDeal(dealId),
      error: { code: "unexpected_error", message: "Unexpected error in deal route" },
      meta: { dealId, correlationId, ts },
    };
  }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  const correlationId = generateCorrelationId("deal");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  // Build payload (all business logic)
  const payload = await buildPayload(ctx, correlationId, ts);

  // Track degraded responses (fire-and-forget, no await)
  if (!payload.ok && payload.error) {
    trackDegradedResponse({
      endpoint: ROUTE,
      code: payload.error.code,
      message: payload.error.message,
      dealId: payload.meta.dealId,
      correlationId,
      bankId: (payload.deal as Record<string, unknown>)?.bank_id as string | null ?? null,
    }).catch(() => {}); // Swallow any errors
  }

  // SEALED RESPONSE: Single return point, all serialization handled inside respond200
  return respond200(payload, headers);
}
