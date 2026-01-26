/**
 * GET /api/deals/[dealId]/context
 *
 * Returns the deal context including borrower info, stage, risk, and completeness.
 *
 * CONTRACT: This endpoint NEVER returns HTTP 500.
 * - All errors are represented as { ok: false, context: null, error: { code, message, correlationId } }
 * - Always returns HTTP 200 with JSON body
 * - Response always includes x-correlation-id and x-buddy-route headers
 * - Errors are diagnosable via correlationId in response + server logs
 *
 * RESPONSE BOUNDARY SEALED: All payload building happens before respond200().
 */
import "server-only";

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import type { DealContext } from "@/lib/deals/contextTypes";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { normalizeGoogleError } from "@/lib/google/errors";
import { sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";
import { trackDegradedResponse } from "@/lib/api/degradedTracker";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  safeWithTimeout,
} from "@/lib/api/respond";
import {
  deriveUnderwritingStance,
  type UnderwritingStanceResult,
  type ChecklistItemInput,
} from "@/lib/underwrite/deriveUnderwritingStance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/deals/[dealId]/context";

/**
 * Create a fallback context when we can't load the real one.
 */
function createFallbackContext(dealId: string): DealContext {
  return {
    dealId,
    stage: "intake",
    borrower: { name: "Unknown Borrower", entityType: "Unknown" },
    risk: { score: 0, flags: [] },
    completeness: { missingDocs: 0, openConditions: 0 },
    permissions: { canApprove: false, canRequest: false, canShare: false },
  };
}

type ContextPayload = {
  ok: boolean;
  context: DealContext | null;
  deal?: { id: string; bank_id: string | null; created_at: string | null };
  ensured_bank?: { ok: true; bankId: string; updated: boolean } | null;
  artifacts?: { queued: number; processing: number; matched: number; failed: number } | null;
  underwritingStance?: UnderwritingStanceResult | null;
  error?: { code: string; message: string };
  meta: { dealId: string; correlationId: string; ts: string };
};

/**
 * Build the response payload. All business logic happens here.
 * Returns a plain JS object ready for serialization.
 */
async function buildPayload(
  ctx: { params: Promise<{ dealId: string }> },
  correlationId: string,
  ts: string
): Promise<ContextPayload> {
  let dealId = "unknown";

  try {
    // === Phase 1: Extract and validate dealId ===
    let rawDealId: string;
    try {
      const params = await ctx.params;
      rawDealId = params.dealId;
    } catch {
      console.error(`[context] correlationId=${correlationId} source=params error=failed_to_extract`);
      return {
        ok: false,
        context: null,
        error: { code: "params_error", message: "Failed to extract request parameters" },
        meta: { dealId: "unknown", correlationId, ts },
      };
    }

    if (!rawDealId || rawDealId === "undefined") {
      return {
        ok: false,
        context: null,
        error: { code: "invalid_deal_id", message: "dealId is empty or invalid" },
        meta: { dealId: rawDealId ?? "null", correlationId, ts },
      };
    }
    dealId = rawDealId;

    // === Phase 2: Auth check ===
    const authResult = await safeWithTimeout(clerkAuth(), 8_000, "clerkAuth", correlationId);
    if (!authResult.ok) {
      return {
        ok: false,
        context: null,
        error: { code: "auth_timeout", message: "Authentication timed out" },
        meta: { dealId, correlationId, ts },
      };
    }

    const { userId } = authResult.data;
    if (!userId) {
      return {
        ok: false,
        context: null,
        error: { code: "unauthorized", message: "User not authenticated" },
        meta: { dealId, correlationId, ts },
      };
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
      return {
        ok: false,
        context: createFallbackContext(dealId),
        error: { code: "deal_load_failed", message: dealResult.error },
        meta: { dealId, correlationId, ts },
      };
    }

    const { data: deal, error: dealErr } = dealResult.data;

    if (dealErr) {
      return {
        ok: false,
        context: createFallbackContext(dealId),
        error: { code: "deal_query_error", message: dealErr.message },
        meta: { dealId, correlationId, ts },
      };
    }

    if (!deal) {
      return {
        ok: false,
        context: null,
        error: { code: "deal_not_found", message: "Deal not found. Verify the dealId exists." },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 5: Tenant enforcement ===
    if (!bankId && !deal.bank_id) {
      return {
        ok: false,
        context: createFallbackContext(dealId),
        error: { code: "bank_context_missing", message: "User has no bank context." },
        meta: { dealId, correlationId, ts },
      };
    }

    let ensured_bank: { ok: true; bankId: string; updated: boolean } | null = null;

    if (bankId) {
      if (deal.bank_id && deal.bank_id !== bankId) {
        return {
          ok: false,
          context: null,
          error: { code: "deal_not_found", message: "Deal not found (bank mismatch)" },
          meta: { dealId, correlationId, ts },
        };
      }

      if (!deal.bank_id) {
        const updateResult = await safeWithTimeout(
          sb.from("deals").update({ bank_id: bankId }).eq("id", dealId),
          10_000,
          "dealBankAssign",
          correlationId
        );
        if (updateResult.ok) {
          ensured_bank = { ok: true, bankId, updated: true };
          deal.bank_id = bankId;
        } else {
          console.warn(`[context] correlationId=${correlationId} dealId=${dealId} bank_assign_failed`);
        }
      } else {
        ensured_bank = { ok: true, bankId: deal.bank_id, updated: false };
      }
    }

    // === Phase 6: Initialize intake (non-blocking, non-fatal) ===
    if (bankId && deal.bank_id) {
      try {
        const init = await initializeIntake(dealId, deal.bank_id, {
          reason: "context_load",
          trigger: "context",
        });
        if (!init.ok) {
          const normalized = normalizeGoogleError(init.error);
          if (normalized.code !== "GOOGLE_UNKNOWN") {
            logLedgerEvent({
              dealId,
              bankId: deal.bank_id,
              eventKey: "deal.intake.failed",
              uiState: "done",
              uiMessage: `Intake init failed: ${normalized.code}`,
              meta: { trigger: "context", error_code: normalized.code, correlationId },
            }).catch(() => {});
          }
        }
      } catch (e: unknown) {
        console.warn(`[context] correlationId=${correlationId} dealId=${dealId} initializeIntake failed: ${(e as Error)?.message}`);
      }
    }

    // === Phase 7: Count missing documents (non-fatal) ===
    let missingDocs = 0;
    const missingDocsResult = await safeWithTimeout(
      sb.from("deal_document_requirements").select("*", { count: "exact", head: true }).eq("deal_id", dealId).eq("status", "missing"),
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
      sb.from("deal_conditions").select("*", { count: "exact", head: true }).eq("deal_id", dealId).in("status", ["pending", "in_progress"]),
      10_000,
      "openConditionsCount",
      correlationId
    );
    if (openConditionsResult.ok && openConditionsResult.data.count != null) {
      openConditions = openConditionsResult.data.count;
    }

    // === Phase 8.5: Derive underwriting stance (non-fatal) ===
    let underwritingStance: UnderwritingStanceResult | null = null;
    const checklistResult = await safeWithTimeout(
      sb.from("deal_checklist_items").select("checklist_key, status, required").eq("deal_id", dealId),
      8_000,
      "checklistForStance",
      correlationId
    );
    if (checklistResult.ok && checklistResult.data.data) {
      const checklistItems: ChecklistItemInput[] = (checklistResult.data.data as Array<{ checklist_key: string; status: string; required?: boolean }>).map((item) => ({
        checklist_key: item.checklist_key,
        status: item.status as ChecklistItemInput["status"],
        required: item.required,
      }));
      underwritingStance = deriveUnderwritingStance({
        checklistItems,
        hasFinancialSnapshot: false, // TODO: detect snapshot existence
      });
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
      risk: { score: deal.risk_score ?? 0, flags: riskFlags },
      completeness: { missingDocs, openConditions },
      permissions: { canApprove: true, canRequest: true, canShare: true },
    };

    // === Phase 12: Emit signal (non-blocking, fire-and-forget) ===
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

    // === Success ===
    return {
      ok: true,
      context,
      deal: { id: deal.id, bank_id: deal.bank_id ?? null, created_at: (deal as Record<string, unknown>).created_at as string | null ?? null },
      ensured_bank,
      artifacts: artifactStats,
      underwritingStance,
      meta: { dealId, correlationId, ts },
    };
  } catch (unexpectedErr) {
    const errInfo = sanitizeErrorForEvidence(unexpectedErr);
    console.error(`[context] correlationId=${correlationId} dealId=${dealId} UNEXPECTED: ${errInfo.message}`);
    return {
      ok: false,
      context: createFallbackContext(dealId),
      error: { code: "unexpected_error", message: "Unexpected error in context route" },
      meta: { dealId, correlationId, ts },
    };
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId("ctx");
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
      bankId: payload.deal?.bank_id ?? null,
    }).catch(() => {}); // Swallow any errors
  }

  // SEALED RESPONSE: Single return point, all serialization handled inside respond200
  return respond200(payload as Record<string, unknown>, headers);
}
