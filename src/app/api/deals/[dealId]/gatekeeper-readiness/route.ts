/**
 * GET /api/deals/[dealId]/gatekeeper-readiness
 *
 * Returns gatekeeper-derived document readiness for a deal.
 * Informational — does NOT block lifecycle transitions.
 *
 * Gate: GATEKEEPER_READINESS_ENABLED flag must be true.
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { isGatekeeperReadinessEnabled } from "@/lib/flags/openaiGatekeeper";
import { computeGatekeeperDocReadiness } from "@/lib/gatekeeper/readinessServer";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  validateUuidParam,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/deals/[dealId]/gatekeeper-readiness";

type Params = Promise<{ dealId: string }>;

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  const correlationId = generateCorrelationId("gk-ready");
  const headers = createHeaders(correlationId, ROUTE);

  // Feature flag gate
  if (!isGatekeeperReadinessEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Feature not enabled" },
      { status: 404, headers: headers as any },
    );
  }

  // Extract + validate dealId
  const { dealId: rawDealId } = await ctx.params;
  const validation = validateUuidParam(rawDealId, "dealId");
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: validation.error },
      { status: 400, headers: headers as any },
    );
  }
  const dealId = validation.value;

  // Auth
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error ?? "Access denied" },
      { status: 403, headers: headers as any },
    );
  }

  try {
    const readiness = await computeGatekeeperDocReadiness(dealId);
    return respond200({ ok: true, readiness }, headers);
  } catch (err) {
    console.error(
      `[gatekeeper-readiness] correlationId=${correlationId} dealId=${dealId} error=`,
      err,
    );
    return NextResponse.json(
      { ok: false, error: "Failed to compute readiness" },
      { status: 500, headers: headers as any },
    );
  }
}
