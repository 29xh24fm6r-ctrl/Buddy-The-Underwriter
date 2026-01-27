import "server-only";

import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
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

const ROUTE = "/api/sandbox/deals/[dealId]";

/**
 * GET /api/sandbox/deals/[dealId]
 *
 * Returns a frozen deal snapshot for sandbox viewing.
 * Read-only. No mutations possible.
 *
 * Accessible to: super_admin, bank_admin, regulator_sandbox
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const correlationId = generateCorrelationId("sbx");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRole(["super_admin", "bank_admin", "regulator_sandbox"]);
    const bankId = await getCurrentBankId();
    const { dealId } = await ctx.params;

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

    const snapshot = await loadSandboxDealSnapshot(dealId, bankId);

    if (!snapshot) {
      return respond200(
        {
          ok: false,
          error: { code: "deal_not_found", message: "Deal not found in sandbox.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    return respond200(
      {
        ok: true,
        snapshot,
        meta: { correlationId, ts, dealId, bankId },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "sandbox_deal_load_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
