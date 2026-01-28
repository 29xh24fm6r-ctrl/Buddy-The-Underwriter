/**
 * POST /api/deals/[dealId]/underwrite/preview
 *
 * Runs the policy engine WITHOUT mutating lifecycle state.
 * Returns a preview of the underwrite result with a disclaimer.
 *
 * Use case: Banker wants to see "is this deal dead?" before all
 * docs are collected. No lifecycle mutation, no status changes.
 *
 * CONTRACT: This endpoint NEVER returns HTTP 500.
 * - All errors are represented as { ok: false, error: { code, message }, ... }
 * - Always returns HTTP 200 with JSON body
 * - Response always includes x-correlation-id and x-buddy-route headers
 */
import "server-only";

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { runPolicyAwareUnderwriting } from "@/lib/underwrite/policyEngine";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { LedgerEventType } from "@/buddy/lifecycle/events";
import { rateLimit } from "@/lib/api/rateLimit";
import { sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/deals/[dealId]/underwrite/preview";

type Context = {
  params: Promise<{ dealId: string }>;
};

export async function POST(
  req: NextRequest,
  ctx: Context
): Promise<Response> {
  const correlationId = generateCorrelationId();
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  let dealId = "unknown";

  try {
    // === Phase 1: Auth ===
    const { userId, role } = await requireRole([
      "super_admin",
      "bank_admin",
      "underwriter",
    ]);

    // === Phase 2: Extract dealId ===
    const params = await ctx.params;
    dealId = params.dealId;

    if (!dealId || dealId === "undefined") {
      return respond200(
        {
          ok: false,
          error: { code: "invalid_deal_id", message: "dealId is empty or invalid" },
          meta: { dealId: dealId ?? "null", correlationId, ts },
        },
        headers
      );
    }

    // === Phase 3: Verify deal access ===
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return respond200(
        {
          ok: false,
          error: { code: access.error ?? "access_denied", message: "Deal not accessible" },
          meta: { dealId, correlationId, ts },
        },
        headers
      );
    }

    // === Phase 4: Rate limiting ===
    const rl = rateLimit({ key: `underwrite-preview:${dealId}`, limit: 1, windowMs: 60_000 });
    if (!rl.ok) {
      return respond200(
        {
          ok: false,
          error: { code: "rate_limited", message: "Preview rate limited. Try again later." },
          resetAt: rl.resetAt,
          meta: { dealId, correlationId, ts },
        },
        headers
      );
    }

    // === Phase 5: Load deal + bank context ===
    const sb = supabaseAdmin();
    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id, lifecycle_stage")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal) {
      return respond200(
        {
          ok: false,
          error: { code: "deal_not_found", message: "Deal not found" },
          meta: { dealId, correlationId, ts },
        },
        headers
      );
    }

    // === Phase 6: Write preview-requested event ===
    writeEvent({
      dealId,
      kind: LedgerEventType.underwrite_preview_requested,
      actorUserId: userId,
      input: {
        lifecycle_stage: deal.lifecycle_stage,
        correlation_id: correlationId,
      },
    }).catch(() => {});

    // === Phase 7: Run policy engine (read-only, no lifecycle mutation) ===
    const policyResult = await runPolicyAwareUnderwriting({
      dealId,
      bankId: deal.bank_id ?? undefined,
    });

    // === Phase 8: Write preview-completed event ===
    writeEvent({
      dealId,
      kind: LedgerEventType.underwrite_preview_completed,
      actorUserId: userId,
      input: {
        correlation_id: correlationId,
        exception_count: policyResult.exceptions.length,
        compliance_score: policyResult.complianceScore,
        mitigant_count: policyResult.suggestedMitigants.length,
      },
    }).catch(() => {});

    // === Phase 9: Return sealed preview result ===
    return respond200(
      {
        ok: true,
        preview: true,
        disclaimer: "PREVIEW \u2014 INCOMPLETE FILE. This analysis may change as documents are collected and verified. Do not use for credit decisions.",
        policy: {
          exceptions: policyResult.exceptions,
          complianceScore: policyResult.complianceScore,
          suggestedMitigants: policyResult.suggestedMitigants,
        },
        lifecycle_stage: deal.lifecycle_stage,
        meta: { dealId, correlationId, ts },
      },
      headers
    );
  } catch (error) {
    // Fire-and-forget failure event
    if (dealId !== "unknown") {
      writeEvent({
        dealId,
        kind: LedgerEventType.underwrite_preview_failed,
        actorUserId: null,
        input: {
          correlation_id: correlationId,
          error: sanitizeErrorForEvidence(error),
        },
      }).catch(() => {});
    }

    console.error(
      `[underwrite/preview] correlationId=${correlationId} dealId=${dealId} error=unhandled`,
      sanitizeErrorForEvidence(error)
    );

    return respond200(
      {
        ok: false,
        error: {
          code: "preview_failed",
          message: "Underwrite preview failed. The policy engine encountered an error.",
        },
        meta: { dealId, correlationId, ts },
      },
      headers
    );
  }
}
