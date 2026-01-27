import "server-only";

/**
 * POST /api/governance/viewed
 *
 * Logs a governance page view event to the deal pipeline ledger.
 * Called by the client when the governance page mounts.
 *
 * Sealed endpoint: always HTTP 200.
 */

import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/governance/viewed";

export async function POST(_req: NextRequest) {
  const correlationId = generateCorrelationId("govvw");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const bankId = await getCurrentBankId();

    // Non-blocking ledger write
    logLedgerEvent({
      dealId: "governance",
      bankId,
      eventKey: "buddy.ai.governance_viewed",
      uiState: "done",
      uiMessage: "Governance Command Center viewed",
      meta: { correlationId },
    }).catch(() => {});

    return respond200({ ok: true, meta: { correlationId, ts } }, headers);
  } catch (error: unknown) {
    const safe = sanitizeError(error, "governance_viewed_failed");
    return respond200({ ok: false, error: safe, meta: { correlationId, ts } }, headers);
  }
}
