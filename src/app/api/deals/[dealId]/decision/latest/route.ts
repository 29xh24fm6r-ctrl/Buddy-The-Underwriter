/**
 * GET /api/deals/[dealId]/decision/latest - Get latest decision snapshot
 *
 * CONTRACT: This endpoint NEVER returns HTTP 500.
 * - All errors are represented as { ok: false, error: { code, message } }
 * - Always returns HTTP 200 with JSON body
 * - Response always includes x-correlation-id and x-buddy-route headers
 *
 * RESPONSE BOUNDARY SEALED: All payload building happens before respond200().
 */
import "server-only";

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";
import { trackDegradedResponse } from "@/lib/api/degradedTracker";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  safeWithTimeout,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/deals/[dealId]/decision/latest";

type DecisionPayload = {
  ok: boolean;
  snapshot: Record<string, unknown> | null;
  error?: { code: string; message: string };
  meta: { dealId: string; correlationId: string; ts: string };
};

/**
 * Build the response payload. All business logic happens here.
 */
async function buildPayload(
  ctx: { params: Promise<{ dealId: string }> },
  correlationId: string,
  ts: string
): Promise<DecisionPayload> {
  let dealId = "unknown";

  try {
    // === Phase 1: Extract dealId ===
    let rawDealId: string;
    try {
      const params = await ctx.params;
      rawDealId = params.dealId;
    } catch {
      console.error(`[decision/latest] correlationId=${correlationId} error=failed_to_extract_params`);
      return {
        ok: false,
        snapshot: null,
        error: { code: "params_error", message: "Failed to extract request parameters" },
        meta: { dealId: "unknown", correlationId, ts },
      };
    }

    if (!rawDealId || rawDealId === "undefined") {
      return {
        ok: false,
        snapshot: null,
        error: { code: "invalid_deal_id", message: "dealId is empty or invalid" },
        meta: { dealId: rawDealId ?? "null", correlationId, ts },
      };
    }
    dealId = rawDealId;

    // === Phase 2: Check access ===
    const accessResult = await safeWithTimeout(
      ensureDealBankAccess(dealId),
      10_000,
      "ensureDealBankAccess",
      correlationId
    );

    if (!accessResult.ok) {
      return {
        ok: false,
        snapshot: null,
        error: { code: "access_check_failed", message: accessResult.error },
        meta: { dealId, correlationId, ts },
      };
    }

    const access = accessResult.data;
    if (!access.ok) {
      return {
        ok: false,
        snapshot: null,
        error: { code: access.error ?? "access_denied", message: access.error ?? "Access denied" },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 3: Load latest snapshot ===
    const sb = supabaseAdmin();
    const snapshotResult = await safeWithTimeout(
      sb
        .from("decision_snapshots")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
      10_000,
      "snapshotLoad",
      correlationId
    );

    if (!snapshotResult.ok) {
      return {
        ok: false,
        snapshot: null,
        error: { code: "snapshot_load_failed", message: snapshotResult.error },
        meta: { dealId, correlationId, ts },
      };
    }

    const { data: snapshot, error: snapshotErr } = snapshotResult.data;

    if (snapshotErr) {
      console.warn(`[decision/latest] correlationId=${correlationId} dealId=${dealId} error=${snapshotErr.message}`);
      return {
        ok: false,
        snapshot: null,
        error: { code: "snapshot_query_error", message: snapshotErr.message },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Success (snapshot can be null if none exists) ===
    return {
      ok: true,
      snapshot: snapshot as Record<string, unknown> | null,
      meta: { dealId, correlationId, ts },
    };
  } catch (unexpectedErr) {
    const errInfo = sanitizeErrorForEvidence(unexpectedErr);
    console.error(`[decision/latest] correlationId=${correlationId} dealId=${dealId} UNEXPECTED: ${errInfo.message}`);
    return {
      ok: false,
      snapshot: null,
      error: { code: "unexpected_error", message: "Unexpected error in decision/latest route" },
      meta: { dealId, correlationId, ts },
    };
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId("dec");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  // Build payload (all business logic)
  const payload = await buildPayload(ctx, correlationId, ts);

  // Track degraded responses (fire-and-forget)
  if (!payload.ok && payload.error) {
    trackDegradedResponse({
      endpoint: ROUTE,
      code: payload.error.code,
      message: payload.error.message,
      dealId: payload.meta.dealId,
      correlationId,
      bankId: null,
    }).catch(() => {});
  }

  // SEALED RESPONSE: Single return point
  return respond200(payload as Record<string, unknown>, headers);
}
