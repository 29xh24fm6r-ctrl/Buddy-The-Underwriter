/**
 * POST /api/deals/[dealId]/underwrite/start
 *
 * Starts the underwriting pipeline:
 * 1. Validates all required checklist items received
 * 2. Runs extraction confidence review
 * 3. Triggers risk scoring
 * 4. Queues memo generation
 * 5. Notifies underwriter
 *
 * CONTRACT: This endpoint NEVER returns HTTP 500.
 * - All errors are represented as { ok: false, error: { code, message }, ... }
 * - Always returns HTTP 200 with JSON body
 * - Response always includes x-correlation-id and x-buddy-route headers
 *
 * RESPONSE BOUNDARY SEALED: All payload building happens before respond200().
 */
import "server-only";

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { runPolicyAwareUnderwriting } from "@/lib/underwrite/policyEngine";
import { verifyUnderwrite } from "@/lib/deals/verifyUnderwrite";
import { buildUnderwriteStartGate } from "@/lib/deals/lifecycleGuards";
import { logUnderwriteVerifyLedger } from "@/lib/deals/underwriteVerifyLedger";
import { upsertDealStatusAndLog } from "@/lib/deals/status";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycle";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
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

const ROUTE = "/api/deals/[dealId]/underwrite/start";

type UnderwriteStartPayload = {
  ok: boolean;
  pipeline_started?: boolean;
  confidence_review?: {
    total_fields: number;
    high_confidence: number;
    confidence_score: number;
    low_confidence_fields: Array<{
      upload_id: string;
      filename: string;
      field_key: string;
      confidence: number;
    }>;
  };
  policy?: Record<string, unknown> | null;
  checklist?: { required: number; received: number };
  notifications_queued?: number;
  gate?: Record<string, unknown>;
  verify?: Record<string, unknown>;
  missing?: string[];
  progress?: { required: number; received: number };
  error?: { code: string; message: string };
  meta: { dealId: string; correlationId: string; ts: string };
};

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * Build the response payload. All business logic happens here.
 */
async function buildPayload(
  req: NextRequest,
  ctx: Context,
  correlationId: string,
  ts: string
): Promise<UnderwriteStartPayload> {
  let dealId = "unknown";
  let bankId: string | null = null;

  try {
    // === Phase 1: Auth ===
    const authResult = await safeWithTimeout(clerkAuth(), 8_000, "clerkAuth", correlationId);
    if (!authResult.ok) {
      return {
        ok: false,
        error: { code: "auth_timeout", message: "Authentication timed out" },
        meta: { dealId: "unknown", correlationId, ts },
      };
    }

    const { userId } = authResult.data;
    if (!userId) {
      return {
        ok: false,
        error: { code: "unauthorized", message: "User not authenticated" },
        meta: { dealId: "unknown", correlationId, ts },
      };
    }

    // === Phase 2: Extract dealId ===
    let rawDealId: string;
    try {
      const params = await ctx.params;
      rawDealId = params.dealId;
    } catch {
      console.error(`[underwrite/start] correlationId=${correlationId} error=failed_to_extract_params`);
      return {
        ok: false,
        error: { code: "params_error", message: "Failed to extract request parameters" },
        meta: { dealId: "unknown", correlationId, ts },
      };
    }

    if (!rawDealId || rawDealId === "undefined") {
      return {
        ok: false,
        error: { code: "invalid_deal_id", message: "dealId is empty or invalid" },
        meta: { dealId: rawDealId ?? "null", correlationId, ts },
      };
    }
    dealId = rawDealId;

    // === Phase 3: Get bank context ===
    const bankResult = await safeWithTimeout(
      getCurrentBankId().catch((e: unknown) => {
        const msg = String((e as Error)?.message ?? e ?? "");
        if (msg === "not_authenticated") return null;
        throw new Error(msg || "bank_not_resolved");
      }),
      8_000,
      "getCurrentBankId",
      correlationId
    );

    if (!bankResult.ok) {
      return {
        ok: false,
        error: { code: "bank_context_timeout", message: "Failed to resolve bank context" },
        meta: { dealId, correlationId, ts },
      };
    }

    bankId = bankResult.data;
    if (!bankId) {
      return {
        ok: false,
        error: { code: "unauthorized", message: "User has no bank context" },
        meta: { dealId, correlationId, ts },
      };
    }

    const sb = supabaseAdmin();

    // === Phase 4: Load deal ===
    const dealResult = await safeWithTimeout(
      sb
        .from("deals")
        .select("id, name, borrower_name, bank_id, lifecycle_stage")
        .eq("id", dealId)
        .single(),
      10_000,
      "dealLoad",
      correlationId
    );

    if (!dealResult.ok) {
      return {
        ok: false,
        error: { code: "deal_load_failed", message: dealResult.error },
        meta: { dealId, correlationId, ts },
      };
    }

    const { data: deal, error: dealError } = dealResult.data;

    if (dealError || !deal) {
      return {
        ok: false,
        error: { code: "deal_not_found", message: "Deal not found" },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 5: Tenant enforcement ===
    if (deal.bank_id && String(deal.bank_id) !== String(bankId)) {
      return {
        ok: false,
        error: { code: "deal_not_found", message: "Deal not found (bank mismatch)" },
        meta: { dealId, correlationId, ts },
      };
    }

    // First-touch binding if deal.bank_id is null
    if (!deal.bank_id) {
      const bankAssignResult = await safeWithTimeout(
        sb.from("deals").update({ bank_id: bankId }).eq("id", dealId),
        10_000,
        "bankAssign",
        correlationId
      );

      if (!bankAssignResult.ok || bankAssignResult.data.error) {
        return {
          ok: false,
          error: { code: "bank_bind_failed", message: "Failed to bind deal to bank" },
          meta: { dealId, correlationId, ts },
        };
      }
      (deal as Record<string, unknown>).bank_id = bankId;
    }

    // Initialize intake (non-fatal)
    try {
      await initializeIntake(dealId, bankId, { reason: "underwrite_start" });
    } catch {
      // Non-fatal
    }

    const testMode = process.env.BANKER_TEST_MODE === "1";

    // === Phase 6: Verify underwrite eligibility ===
    let verify: Awaited<ReturnType<typeof verifyUnderwrite>>;
    try {
      verify = await verifyUnderwrite({
        dealId,
        actor: "system",
        logAttempt: !testMode,
        verifySource: "runtime",
        verifyDetails: {
          url: req.url,
          auth: true,
          html: false,
          metaFallback: false,
          redacted: true,
          error: testMode ? "banker_test_mode" : undefined,
        },
      });
    } catch (e: unknown) {
      console.error(`[underwrite/start] correlationId=${correlationId} dealId=${dealId} verifyUnderwrite failed`);
      return {
        ok: false,
        error: { code: "verify_failed", message: "Underwrite verification failed" },
        meta: { dealId, correlationId, ts },
      };
    }

    if (testMode) {
      try {
        await logUnderwriteVerifyLedger({
          dealId,
          bankId,
          status: "fail",
          source: "runtime",
          details: {
            url: req.url,
            auth: true,
            html: false,
            metaFallback: false,
            error: "banker_test_mode",
            redacted: true,
          },
          recommendedNextAction: verify.ok ? null : verify.recommendedNextAction,
          diagnostics: verify.ok ? null : (verify.diagnostics as Record<string, unknown>),
        });
      } catch {
        // Non-fatal
      }
    }

    const gate = buildUnderwriteStartGate({
      lifecycleStage: deal.lifecycle_stage,
      verifyOk: verify.ok && !testMode,
      authOk: true,
      testMode,
    });

    if (!gate.allowed) {
      return {
        ok: false,
        error: { code: "underwrite_verify_failed", message: "Underwrite verification failed" },
        gate: gate as Record<string, unknown>,
        verify: verify as Record<string, unknown>,
        meta: { dealId, correlationId, ts },
      };
    }

    if (deal.lifecycle_stage !== "collecting" && deal.lifecycle_stage !== "ready") {
      return {
        ok: false,
        error: { code: "deal_not_ready", message: "Deal not ready for underwriting" },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 7: Verify checklist requirements ===
    const checklistResult = await safeWithTimeout(
      sb
        .from("deal_checklist_items")
        .select("id, checklist_key, required, received_at")
        .eq("deal_id", dealId),
      10_000,
      "checklistLoad",
      correlationId
    );

    const checklist = checklistResult.ok ? checklistResult.data.data : [];
    const requiredItems = checklist?.filter((i: { required: boolean }) => i.required) || [];
    const receivedRequired = requiredItems.filter((i: { received_at: string | null }) => i.received_at);

    const docCountResult = await safeWithTimeout(
      sb.from("deal_documents").select("id", { count: "exact", head: true }).eq("deal_id", dealId),
      10_000,
      "docCount",
      correlationId
    );
    const docCount = docCountResult.ok ? docCountResult.data.count : 0;

    if (requiredItems.length === 0) {
      return {
        ok: false,
        error: { code: "no_checklist_items", message: "No required checklist items defined" },
        meta: { dealId, correlationId, ts },
      };
    }

    if (receivedRequired.length < requiredItems.length) {
      const missing = requiredItems
        .filter((i: { received_at: string | null }) => !i.received_at)
        .map((i: { checklist_key: string }) => i.checklist_key);

      return {
        ok: false,
        error: { code: "missing_required_items", message: "Not all required items received" },
        missing,
        progress: {
          required: requiredItems.length,
          received: receivedRequired.length,
        },
        meta: { dealId, correlationId, ts },
      };
    }

    // Write unblocked event (non-fatal)
    try {
      await writeEvent({
        dealId,
        kind: "underwriting.unblocked",
        actorUserId: userId,
        input: {
          required: requiredItems.length,
          received: receivedRequired.length,
        },
      });

      await logLedgerEvent({
        dealId,
        bankId: deal.bank_id as string,
        eventKey: "underwriting.unblocked",
        uiState: "done",
        uiMessage: "Underwriting unblocked",
        meta: {
          required: requiredItems.length,
          received: receivedRequired.length,
        },
      });
    } catch {
      // Non-fatal
    }

    // === Phase 8: Check extraction confidence ===
    const uploadsResult = await safeWithTimeout(
      sb
        .from("deal_uploads")
        .select(`
          upload_id,
          uploads (
            filename,
            doc_extractions (
              id,
              status,
              confidence_score,
              doc_fields (
                id,
                field_key,
                confidence,
                needs_attention
              )
            )
          )
        `)
        .eq("deal_id", dealId),
      15_000,
      "uploadsLoad",
      correlationId
    );

    const uploads = uploadsResult.ok ? uploadsResult.data.data : [];

    const lowConfidenceFields: Array<{
      upload_id: string;
      filename: string;
      field_key: string;
      confidence: number;
    }> = [];
    let totalFields = 0;
    let highConfidenceFields = 0;

    uploads?.forEach((upload: Record<string, unknown>) => {
      const uploadsData = upload.uploads as Record<string, unknown> | null;
      const extractions = uploadsData?.doc_extractions as Array<Record<string, unknown>> | undefined;
      extractions?.forEach((extraction) => {
        const fields = extraction.doc_fields as Array<Record<string, unknown>> | undefined;
        fields?.forEach((field) => {
          totalFields++;
          const confidence = field.confidence as number | null;
          if (confidence && confidence >= 0.85) {
            highConfidenceFields++;
          } else if (field.needs_attention || (confidence && confidence < 0.7)) {
            lowConfidenceFields.push({
              upload_id: upload.upload_id as string,
              filename: (uploadsData?.filename as string) ?? "unknown",
              field_key: field.field_key as string,
              confidence: confidence ?? 0,
            });
          }
        });
      });
    });

    const confidenceScore = totalFields > 0
      ? Math.round((highConfidenceFields / totalFields) * 100)
      : 0;

    // === Phase 9: Advance lifecycle to underwriting ===
    let lifecycle: Awaited<ReturnType<typeof advanceDealLifecycle>>;
    try {
      lifecycle = await advanceDealLifecycle({
        dealId,
        toStage: "underwriting",
        reason: "underwriting_started",
        source: "underwrite_start",
        actor: { userId, type: "user" },
      });
    } catch (e: unknown) {
      console.error(`[underwrite/start] correlationId=${correlationId} dealId=${dealId} advanceDealLifecycle failed`);
      return {
        ok: false,
        error: { code: "lifecycle_advance_failed", message: "Failed to advance deal lifecycle" },
        meta: { dealId, correlationId, ts },
      };
    }

    if (!lifecycle.ok) {
      return {
        ok: false,
        error: { code: "lifecycle_advance_failed", message: "Failed to start underwriting" },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 10: Run policy-aware underwriting ===
    let policy: Awaited<ReturnType<typeof runPolicyAwareUnderwriting>> | null = null;
    try {
      policy = await runPolicyAwareUnderwriting({ dealId, bankId });
    } catch (e: unknown) {
      const errInfo = sanitizeErrorForEvidence(e);
      console.error(`[underwrite/start] correlationId=${correlationId} dealId=${dealId} policy engine failed: ${errInfo.message}`);
      return {
        ok: false,
        error: { code: "policy_engine_failed", message: "Policy engine failed" },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 11: Emit events (non-fatal) ===
    try {
      await writeEvent({
        dealId,
        kind: "deal.underwriting.started",
        actorUserId: userId,
        input: {
          checklist_complete: true,
          required_items: requiredItems.length,
          checklist_snapshot: requiredItems.map((i: { checklist_key: string }) => i.checklist_key),
          document_count: docCount ?? null,
        },
        meta: {
          confidence_score: confidenceScore,
          low_confidence_fields: lowConfidenceFields.length,
          policy_compliance_score: policy?.complianceScore ?? null,
          policy_exceptions: policy?.exceptions?.length ?? 0,
          triggered_by: "manual",
        },
      });

      await logLedgerEvent({
        dealId,
        bankId: deal.bank_id as string,
        eventKey: "deal.underwriting.started",
        uiState: "done",
        uiMessage: "Underwriting started",
        meta: {
          required_items: requiredItems.length,
          received_items: receivedRequired.length,
          confidence_score: confidenceScore,
        },
      });

      emitBuddySignalServer({
        type: "deal.underwriting.started",
        source: "api/deals/[dealId]/underwrite/start",
        ts: Date.now(),
        dealId,
        payload: {
          required_items: requiredItems.length,
          received_items: receivedRequired.length,
        },
      });
    } catch {
      // Non-fatal
    }

    // Update deal status (non-fatal)
    try {
      await upsertDealStatusAndLog({
        dealId,
        stage: "underwriting",
        actorUserId: userId,
      });
    } catch (e: unknown) {
      console.warn(`[underwrite/start] correlationId=${correlationId} dealId=${dealId} deal_status update failed (non-fatal)`);
    }

    // === Phase 12: Queue notifications (non-fatal) ===
    let notificationsQueued = 0;
    try {
      const { data: bankUsers } = await sb
        .from("bank_memberships")
        .select("user_id, users (email)")
        .eq("bank_id", deal.bank_id as string);

      const underwriterEmails: string[] = (bankUsers
        ?.map((m: Record<string, unknown>) => (m.users as Record<string, unknown>)?.email)
        .filter((e): e is string => typeof e === "string") || []);

      if (underwriterEmails.length > 0) {
        await sb.from("notification_queue").insert(
          underwriterEmails.map((email) => ({
            deal_id: dealId,
            notification_type: "email",
            recipient: email,
            subject: `Deal Ready for Underwriting: ${deal.name || deal.borrower_name || "Untitled"}`,
            body: `All required documents have been received and confirmed by the borrower. The deal is ready for underwriting review.`,
            template_key: "deal_ready_for_underwriting",
            metadata: {
              deal_id: dealId,
              deal_name: deal.name,
              confidence_score: confidenceScore,
              low_confidence_count: lowConfidenceFields.length,
            },
          }))
        );
        notificationsQueued = underwriterEmails.length;
      }
    } catch {
      // Non-fatal
    }

    // === Success ===
    return {
      ok: true,
      pipeline_started: true,
      confidence_review: {
        total_fields: totalFields,
        high_confidence: highConfidenceFields,
        confidence_score: confidenceScore,
        low_confidence_fields: lowConfidenceFields,
      },
      policy: policy as Record<string, unknown> | null,
      checklist: {
        required: requiredItems.length,
        received: receivedRequired.length,
      },
      notifications_queued: notificationsQueued,
      meta: { dealId, correlationId, ts },
    };
  } catch (unexpectedErr) {
    const errInfo = sanitizeErrorForEvidence(unexpectedErr);
    console.error(`[underwrite/start] correlationId=${correlationId} dealId=${dealId} UNEXPECTED: ${errInfo.message}`);
    return {
      ok: false,
      error: { code: "unexpected_error", message: "Unexpected error starting underwriting" },
      meta: { dealId, correlationId, ts },
    };
  }
}

export async function POST(req: NextRequest, ctx: Context) {
  const correlationId = generateCorrelationId("uws");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  // Build payload (all business logic)
  const payload = await buildPayload(req, ctx, correlationId, ts);

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
