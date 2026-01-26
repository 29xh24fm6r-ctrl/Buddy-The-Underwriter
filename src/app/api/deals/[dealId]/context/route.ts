// src/app/api/deals/[dealId]/context/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import type { DealContext } from "@/lib/deals/contextTypes";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { normalizeGoogleError } from "@/lib/google/errors";
import { jsonSafe, sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generate a correlation ID for request tracing.
 */
function generateCorrelationId(): string {
  return `ctx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Timeout helper that doesn't throw - returns result or null.
 */
async function safeWithTimeout<T>(
  p: PromiseLike<T>,
  ms: number,
  label: string,
  correlationId: string
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const result = await Promise.race<T | "TIMEOUT">([
      Promise.resolve(p),
      new Promise<"TIMEOUT">((resolve) => setTimeout(() => resolve("TIMEOUT"), ms)),
    ]);
    if (result === "TIMEOUT") {
      console.warn(`[context] correlationId=${correlationId} timeout=${label}`);
      return { ok: false, error: `timeout:${label}` };
    }
    return { ok: true, data: result };
  } catch (err) {
    const errInfo = sanitizeErrorForEvidence(err);
    console.warn(`[context] correlationId=${correlationId} error=${label}: ${errInfo.message}`);
    return { ok: false, error: errInfo.message };
  }
}

/**
 * Create a fallback context when we can't load the real one.
 */
function createFallbackContext(dealId: string): DealContext {
  return {
    dealId,
    stage: "intake",
    borrower: {
      name: "Unknown Borrower",
      entityType: "Unknown",
    },
    risk: {
      score: 0,
      flags: [],
    },
    completeness: {
      missingDocs: 0,
      openConditions: 0,
    },
    permissions: {
      canApprove: false,
      canRequest: false,
      canShare: false,
    },
  };
}

type ContextResponse = {
  ok: boolean;
  context: DealContext | null;
  deal?: { id: string; bank_id: string | null; created_at: string | null };
  ensured_bank?: { ok: true; bankId: string; updated: boolean } | null;
  artifacts?: { queued: number; processing: number; matched: number; failed: number } | null;
  error?: { code: string; message: string; correlationId: string };
  meta: { dealId: string; correlationId: string; ts: string };
};

/**
 * Create a JSON response with:
 * - Status 200 (NEVER 500)
 * - x-correlation-id header
 * - JSON-safe serialization
 */
function createJsonResponse(body: ContextResponse, correlationId: string): NextResponse {
  try {
    const safeBody = jsonSafe(body);
    return NextResponse.json(safeBody, {
      status: 200,
      headers: {
        "x-correlation-id": correlationId,
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (serializationErr) {
    console.error(`[context] correlationId=${correlationId} source=serialization error=failed_to_serialize`);
    return NextResponse.json(
      {
        ok: false,
        context: null,
        error: { code: "serialization_error", message: "Failed to serialize response", correlationId },
        meta: { dealId: "unknown", correlationId, ts: new Date().toISOString() },
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

/**
 * GET /api/deals/[dealId]/context
 *
 * Returns the deal context including borrower info, stage, risk, and completeness.
 *
 * CONTRACT: This endpoint NEVER returns HTTP 500.
 * - All errors are represented as { ok: false, context: null, error: { code, message, correlationId } }
 * - Always returns HTTP 200 with JSON body
 * - Errors are diagnosable via correlationId in response + server logs
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId();
  let dealId = "unknown";
  const ts = new Date().toISOString();

  try {
    // === Phase 1: Extract and validate dealId ===
    let rawDealId: string;
    try {
      const params = await ctx.params;
      rawDealId = params.dealId;
    } catch (paramErr) {
      console.error(`[context] correlationId=${correlationId} source=params error=failed_to_extract`);
      return createJsonResponse(
        {
          ok: false,
          context: null,
          error: { code: "params_error", message: "Failed to extract request parameters", correlationId },
          meta: { dealId: "unknown", correlationId, ts },
        },
        correlationId
      );
    }

    if (!rawDealId || rawDealId === "undefined") {
      return createJsonResponse(
        {
          ok: false,
          context: null,
          error: { code: "invalid_deal_id", message: "dealId is empty or invalid", correlationId },
          meta: { dealId: rawDealId ?? "null", correlationId, ts },
        },
        correlationId
      );
    }
    dealId = rawDealId;

    // === Phase 2: Auth check ===
    const authResult = await safeWithTimeout(clerkAuth(), 8_000, "clerkAuth", correlationId);
    if (!authResult.ok) {
      return createJsonResponse(
        {
          ok: false,
          context: null,
          error: { code: "auth_timeout", message: "Authentication timed out", correlationId },
          meta: { dealId, correlationId, ts },
        },
        correlationId
      );
    }

    const { userId } = authResult.data;
    if (!userId) {
      return createJsonResponse(
        {
          ok: false,
          context: null,
          error: { code: "unauthorized", message: "User not authenticated", correlationId },
          meta: { dealId, correlationId, ts },
        },
        correlationId
      );
    }

    // === Phase 3: Get bank context ===
    const bankResult = await safeWithTimeout(getCurrentBankId(), 8_000, "getCurrentBankId", correlationId);
    const bankId = bankResult.ok ? bankResult.data : null;

    const sb = supabaseAdmin();

    // === Phase 4: Load deal ===
    const dealResult = await safeWithTimeout(
      sb
        .from("deals")
        .select("id, bank_id, borrower_name, entity_type, stage, risk_score, created_at")
        .eq("id", dealId)
        .maybeSingle(),
      10_000,
      "dealLoad",
      correlationId
    );

    if (!dealResult.ok) {
      return createJsonResponse(
        {
          ok: false,
          context: createFallbackContext(dealId),
          error: { code: "deal_load_failed", message: dealResult.error, correlationId },
          meta: { dealId, correlationId, ts },
        },
        correlationId
      );
    }

    const { data: deal, error: dealErr } = dealResult.data;

    if (dealErr) {
      return createJsonResponse(
        {
          ok: false,
          context: createFallbackContext(dealId),
          error: { code: "deal_query_error", message: dealErr.message, correlationId },
          meta: { dealId, correlationId, ts },
        },
        correlationId
      );
    }

    if (!deal) {
      return createJsonResponse(
        {
          ok: false,
          context: null,
          error: {
            code: "deal_not_found",
            message: "Deal not found. Verify the dealId exists in the connected Supabase environment.",
            correlationId,
          },
          meta: { dealId, correlationId, ts },
        },
        correlationId
      );
    }

    // === Phase 5: Tenant enforcement ===
    if (!bankId && !deal.bank_id) {
      return createJsonResponse(
        {
          ok: false,
          context: createFallbackContext(dealId),
          error: {
            code: "bank_context_missing",
            message: "User has no bank context. Check getCurrentBankId().",
            correlationId,
          },
          meta: { dealId, correlationId, ts },
        },
        correlationId
      );
    }

    let ensured_bank: { ok: true; bankId: string; updated: boolean } | null = null;

    if (bankId) {
      if (deal.bank_id && deal.bank_id !== bankId) {
        // Bank mismatch - don't leak existence across tenants
        return createJsonResponse(
          {
            ok: false,
            context: null,
            error: { code: "deal_not_found", message: "Deal not found (bank mismatch)", correlationId },
            meta: { dealId, correlationId, ts },
          },
          correlationId
        );
      }

      if (!deal.bank_id) {
        // First-touch tenant binding
        const updateResult = await safeWithTimeout(
          sb.from("deals").update({ bank_id: bankId }).eq("id", dealId),
          10_000,
          "dealBankAssign",
          correlationId
        );
        if (!updateResult.ok) {
          // Non-fatal - continue with context load
          console.warn(`[context] correlationId=${correlationId} dealId=${dealId} bank_assign_failed`);
        } else {
          ensured_bank = { ok: true, bankId, updated: true };
          deal.bank_id = bankId;
        }
      } else {
        ensured_bank = { ok: true, bankId: deal.bank_id, updated: false };
      }
    }

    // === Phase 6: Initialize intake (non-blocking) ===
    if (bankId && deal.bank_id) {
      try {
        const init = await initializeIntake(dealId, deal.bank_id, {
          reason: "context_load",
          trigger: "context",
        });
        if (!init.ok) {
          const normalized = normalizeGoogleError(init.error);
          if (normalized.code !== "GOOGLE_UNKNOWN") {
            await logLedgerEvent({
              dealId,
              bankId: deal.bank_id,
              eventKey: "deal.intake.failed",
              uiState: "done",
              uiMessage: `Intake init failed: ${normalized.code}`,
              meta: {
                trigger: "context",
                error_code: normalized.code,
                error_message: normalized.message,
                correlationId,
              },
            }).catch(() => {}); // Don't throw on ledger failure
          }
        }
      } catch (e: any) {
        // Intake init is non-fatal
        console.warn(`[context] correlationId=${correlationId} dealId=${dealId} initializeIntake failed: ${e?.message}`);
      }
    }

    // === Phase 7: Count missing documents (non-fatal) ===
    let missingDocs = 0;
    const missingDocsResult = await safeWithTimeout(
      sb
        .from("deal_document_requirements")
        .select("*", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("status", "missing"),
      10_000,
      "missingDocsCount",
      correlationId
    );
    if (missingDocsResult.ok && missingDocsResult.data.count != null) {
      missingDocs = missingDocsResult.data.count;
    }

    // === Phase 8: Count open conditions (non-fatal) ===
    let openConditions = 0;
    const openConditionsResult = await safeWithTimeout(
      sb
        .from("deal_conditions")
        .select("*", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .in("status", ["pending", "in_progress"]),
      10_000,
      "openConditionsCount",
      correlationId
    );
    if (openConditionsResult.ok && openConditionsResult.data.count != null) {
      openConditions = openConditionsResult.data.count;
    }

    // === Phase 9: Risk flags ===
    const riskFlags: string[] = [];
    if (deal.risk_score && deal.risk_score > 70) riskFlags.push("High Risk Score");

    // === Phase 10: Artifact stats (optional, non-fatal) ===
    let artifactStats: { queued: number; processing: number; matched: number; failed: number } | null = null;
    const artifactResult = await safeWithTimeout(
      sb.rpc("get_deal_artifacts_summary", { p_deal_id: dealId }),
      5_000,
      "artifactStats",
      correlationId
    );
    if (artifactResult.ok) {
      const row = Array.isArray(artifactResult.data.data) ? artifactResult.data.data[0] : artifactResult.data.data;
      if (row) {
        artifactStats = {
          queued: Number(row.queued) || 0,
          processing: Number(row.processing) || 0,
          matched: Number(row.matched) || 0,
          failed: Number(row.failed) || 0,
        };
      }
    }

    // === Phase 11: Build context ===
    const context: DealContext = {
      dealId: deal.id,
      stage: (deal.stage as DealContext["stage"]) ?? "intake",
      borrower: {
        name: deal.borrower_name ?? "Unknown Borrower",
        entityType: deal.entity_type ?? "Unknown",
      },
      risk: {
        score: deal.risk_score ?? 0,
        flags: riskFlags,
      },
      completeness: {
        missingDocs,
        openConditions,
      },
      permissions: {
        canApprove: true,
        canRequest: true,
        canShare: true,
      },
    };

    // === Phase 12: Emit signal (non-blocking) ===
    try {
      emitBuddySignalServer({
        type: "deal.loaded",
        source: "api/deals/[dealId]/context",
        ts: Date.now(),
        dealId,
        payload: { stage: deal.stage ?? null, risk_score: deal.risk_score ?? null, correlationId },
      });
    } catch {
      // Signal emission is non-fatal
    }

    // === Success response ===
    return createJsonResponse(
      {
        ok: true,
        context,
        deal: { id: deal.id, bank_id: deal.bank_id ?? null, created_at: (deal as any).created_at ?? null },
        ensured_bank,
        artifacts: artifactStats,
        meta: { dealId, correlationId, ts },
      },
      correlationId
    );
  } catch (unexpectedErr) {
    // === Ultimate safety net ===
    const errInfo = sanitizeErrorForEvidence(unexpectedErr);
    console.error(`[context] correlationId=${correlationId} dealId=${dealId} UNEXPECTED: ${errInfo.message}`);
    return createJsonResponse(
      {
        ok: false,
        context: createFallbackContext(dealId),
        error: { code: "unexpected_error", message: "Unexpected error in context route", correlationId },
        meta: { dealId, correlationId, ts },
      },
      correlationId
    );
  }
}
