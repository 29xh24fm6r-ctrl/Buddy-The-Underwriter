import "server-only";

import { NextRequest } from "next/server";
import {
  getActiveGrant,
  validateGrantScope,
  logExaminerActivity,
} from "@/lib/examiner/examinerAccessGrants";
import { loadSandboxDealSnapshot } from "@/lib/sandbox/loadRegulatorSandbox";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
  validateUuidParam,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/examiner/portal/deals/[dealId]";

/**
 * GET /api/examiner/portal/deals/[dealId]?grant_id=...
 *
 * Read-only examiner portal for viewing a deal.
 * Requires a valid, non-expired examiner access grant.
 * Every access is logged to the examiner activity ledger.
 *
 * No authentication via Clerk — grant_id is the access token.
 * No ZIP downloads by default. Inline hash verification only.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const correlationId = generateCorrelationId("expt");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const { dealId } = await ctx.params;
    const url = new URL(req.url);
    const grantId = url.searchParams.get("grant_id") ?? "";

    // Validate params
    const dealCheck = validateUuidParam(dealId, "dealId");
    if (!dealCheck.ok) {
      return respond200(
        {
          ok: false,
          error: { code: "invalid_deal_id", message: dealCheck.error!, correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    const grantCheck = validateUuidParam(grantId, "grant_id");
    if (!grantCheck.ok) {
      return respond200(
        {
          ok: false,
          error: { code: "invalid_grant_id", message: "A valid grant_id is required.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    // Validate grant
    const grant = await getActiveGrant(grantId);
    if (!grant) {
      return respond200(
        {
          ok: false,
          error: { code: "grant_not_found", message: "Grant not found, expired, or revoked.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    // Validate scope
    const scopeCheck = validateGrantScope(grant, dealId, "all");
    if (!scopeCheck.allowed) {
      return respond200(
        {
          ok: false,
          error: { code: "scope_denied", message: scopeCheck.reason, correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    // Load snapshot (read-only, frozen data)
    const snapshot = await loadSandboxDealSnapshot(dealId, grant.bank_id);

    if (!snapshot) {
      return respond200(
        {
          ok: false,
          error: { code: "deal_not_found", message: "Deal not found.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    // Log activity (non-blocking)
    await logExaminerActivity({
      grant_id: grantId,
      action: "viewed_deal",
      deal_id: dealId,
      detail: { correlationId, ts },
    });

    // --- Omega belief augmentation (read-only, non-blocking) ---
    let omegaState: unknown = null;
    let omegaAvailable = false;
    try {
      const { readOmegaState } = await import("@/lib/omega/readOmegaState");
      const omegaResult = await readOmegaState({
        stateType: "examiner_drop",
        id: dealId,
        correlationId,
      });
      if (omegaResult.ok) {
        omegaState = omegaResult.data;
        omegaAvailable = true;
      }
    } catch {
      // Omega unavailable — examiner portal operates normally
    }

    return respond200(
      {
        ok: true,
        snapshot,
        grant: {
          examiner_name: grant.examiner_name,
          organization: grant.organization,
          expires_at: grant.expires_at,
        },
        omega_state: omegaState,
        omega_available: omegaAvailable,
        meta: { correlationId, ts, dealId },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "portal_view_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
