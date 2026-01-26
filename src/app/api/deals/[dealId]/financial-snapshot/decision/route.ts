/**
 * GET /api/deals/[dealId]/financial-snapshot/decision
 *
 * Returns the latest financial snapshot decision for a deal.
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
import { requireRole } from "@/lib/auth/requireRole";
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

const ROUTE = "/api/deals/[dealId]/financial-snapshot/decision";

type FinancialDecisionPayload = {
  ok: boolean;
  dealId: string;
  decision: Record<string, unknown> | null;
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
): Promise<FinancialDecisionPayload> {
  let dealId = "unknown";

  try {
    // === Phase 1: Extract dealId ===
    let rawDealId: string;
    try {
      const params = await ctx.params;
      rawDealId = params.dealId;
    } catch {
      console.error(`[financial-snapshot/decision] correlationId=${correlationId} error=failed_to_extract_params`);
      return {
        ok: false,
        dealId: "unknown",
        decision: null,
        snapshot: null,
        error: { code: "params_error", message: "Failed to extract request parameters" },
        meta: { dealId: "unknown", correlationId, ts },
      };
    }

    if (!rawDealId || rawDealId === "undefined") {
      return {
        ok: false,
        dealId: rawDealId ?? "null",
        decision: null,
        snapshot: null,
        error: { code: "invalid_deal_id", message: "dealId is empty or invalid" },
        meta: { dealId: rawDealId ?? "null", correlationId, ts },
      };
    }
    dealId = rawDealId;

    // === Phase 2: Role check ===
    const roleResult = await safeWithTimeout(
      requireRole(["super_admin", "bank_admin", "underwriter"]),
      8_000,
      "requireRole",
      correlationId
    );

    if (!roleResult.ok) {
      return {
        ok: false,
        dealId,
        decision: null,
        snapshot: null,
        error: { code: "role_check_failed", message: roleResult.error },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 3: Check access ===
    const accessResult = await safeWithTimeout(
      ensureDealBankAccess(dealId),
      10_000,
      "ensureDealBankAccess",
      correlationId
    );

    if (!accessResult.ok) {
      return {
        ok: false,
        dealId,
        decision: null,
        snapshot: null,
        error: { code: "access_check_failed", message: accessResult.error },
        meta: { dealId, correlationId, ts },
      };
    }

    const access = accessResult.data;
    if (!access.ok) {
      return {
        ok: false,
        dealId,
        decision: null,
        snapshot: null,
        error: { code: access.error ?? "access_denied", message: access.error ?? "Access denied" },
        meta: { dealId, correlationId, ts },
      };
    }

    const bankId = access.bankId;

    // === Phase 4: Load financial snapshot decision ===
    const sb = supabaseAdmin();
    const decisionResult = await safeWithTimeout(
      sb
        .from("financial_snapshot_decisions")
        .select(
          "id, financial_snapshot_id, deal_id, bank_id, inputs_json, stress_json, sba_json, narrative_json, created_at"
        )
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
      10_000,
      "decisionLoad",
      correlationId
    );

    if (!decisionResult.ok) {
      return {
        ok: false,
        dealId,
        decision: null,
        snapshot: null,
        error: { code: "decision_load_failed", message: decisionResult.error },
        meta: { dealId, correlationId, ts },
      };
    }

    const { data: decision, error: decisionErr } = decisionResult.data;

    if (decisionErr) {
      console.warn(`[financial-snapshot/decision] correlationId=${correlationId} dealId=${dealId} error=${decisionErr.message}`);
      return {
        ok: false,
        dealId,
        decision: null,
        snapshot: null,
        error: { code: "decision_query_error", message: decisionErr.message },
        meta: { dealId, correlationId, ts },
      };
    }

    if (!decision) {
      return {
        ok: false,
        dealId,
        decision: null,
        snapshot: null,
        error: { code: "decision_not_found", message: "No financial snapshot decision found for this deal" },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 5: Load associated snapshot (non-fatal) ===
    let snapshot: Record<string, unknown> | null = null;
    if (decision.financial_snapshot_id) {
      const snapshotResult = await safeWithTimeout(
        sb
          .from("financial_snapshots")
          .select("id, as_of_timestamp, snapshot_hash, created_at")
          .eq("id", decision.financial_snapshot_id)
          .eq("deal_id", dealId)
          .eq("bank_id", bankId)
          .maybeSingle(),
        10_000,
        "snapshotLoad",
        correlationId
      );

      if (snapshotResult.ok && snapshotResult.data.data) {
        snapshot = snapshotResult.data.data as Record<string, unknown>;
      }
    }

    // === Success ===
    return {
      ok: true,
      dealId,
      decision: decision as Record<string, unknown>,
      snapshot,
      meta: { dealId, correlationId, ts },
    };
  } catch (unexpectedErr) {
    const errInfo = sanitizeErrorForEvidence(unexpectedErr);
    console.error(`[financial-snapshot/decision] correlationId=${correlationId} dealId=${dealId} UNEXPECTED: ${errInfo.message}`);
    return {
      ok: false,
      dealId,
      decision: null,
      snapshot: null,
      error: { code: "unexpected_error", message: "Unexpected error in financial-snapshot/decision route" },
      meta: { dealId, correlationId, ts },
    };
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId("fsd");
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
