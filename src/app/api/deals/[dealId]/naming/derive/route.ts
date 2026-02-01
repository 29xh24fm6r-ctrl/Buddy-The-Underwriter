/**
 * POST /api/deals/[dealId]/naming/derive
 *
 * Idempotent naming derivation endpoint.
 * Belt-and-suspenders fallback: cockpit calls this when a deal is stuck
 * with naming_method='provisional' but has matched artifacts.
 *
 * Throttled server-side via runNamingDerivation's 30s DB-backed throttle.
 * Safe to call repeatedly — will return { ok: true, throttled: true } if
 * called too soon after a previous derivation.
 */

import "server-only";

import { NextRequest } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
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

const ROUTE = "/api/deals/[dealId]/naming/derive";

type Params = Promise<{ dealId: string }>;

export async function POST(req: NextRequest, ctx: { params: Params }) {
  const correlationId = generateCorrelationId("nd");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const { dealId } = await ctx.params;

    const uuidCheck = validateUuidParam(dealId, "dealId");
    if (!uuidCheck.ok) {
      return respond200(
        { ok: false, error: { code: "invalid_deal_id", message: uuidCheck.error }, meta: { dealId: String(dealId), correlationId, ts } },
        headers,
      );
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return respond200(
        { ok: false, error: { code: access.error, message: `Access denied: ${access.error}` }, meta: { dealId, correlationId, ts } },
        headers,
      );
    }

    const { maybeTriggerDealNaming } = await import(
      "@/lib/naming/maybeTriggerDealNaming"
    );

    const result = await maybeTriggerDealNaming(dealId, {
      bankId: access.bankId,
      reason: "manual_derive_endpoint",
    });

    return respond200(
      {
        ok: true,
        ...result,
        meta: { dealId, correlationId, ts },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "naming_derive_failed");
    return respond200(
      { ok: false, error: safe, meta: { dealId: "unknown", correlationId, ts } },
      headers,
    );
  }
}
