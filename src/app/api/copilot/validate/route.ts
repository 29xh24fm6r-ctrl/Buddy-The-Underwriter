/**
 * Banker Copilot: Validate Case
 *
 * POST /api/copilot/validate { caseId }
 *
 * Runs read-only validation checks on a case via the MCP tool.
 * Banker + Builder modes only.
 */
import "server-only";

import { NextRequest } from "next/server";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
} from "@/lib/api/respond";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { canValidateCase } from "@/lib/modes/gates";
import { getBuddyMode } from "@/lib/modes/mode";
import { handleValidateCase } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

const ROUTE = "/api/copilot/validate";

export async function POST(req: NextRequest) {
  const correlationId = generateCorrelationId("cop-v");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const bankId = await getCurrentBankId();
    const mode = getBuddyMode();
    if (!canValidateCase(mode)) {
      return respond200(
        { ok: false, error: { code: "mode_denied", message: "Case validation not available in this mode." }, meta: { correlationId, ts } },
        headers,
      );
    }

    const body = await req.json().catch(() => ({}));
    const caseId = typeof body.caseId === "string" ? body.caseId : "";
    if (!caseId) {
      return respond200(
        { ok: false, error: { code: "missing_case_id", message: "caseId is required." }, meta: { correlationId, ts } },
        headers,
      );
    }

    const result = await handleValidateCase(caseId, bankId);

    // Ledger the validation (non-blocking)
    try {
      const { writeBuddySignal } = await import("@/buddy/server/writeBuddySignal");
      await writeBuddySignal({
        type: "user.action",
        ts: Date.now(),
        source: "copilot/validate",
        dealId: caseId,
        payload: { correlationId, action: "validate_case", result_ok: result.ok },
      });
    } catch { /* non-blocking */ }

    if (!result.ok) {
      return respond200(
        { ok: false, error: { code: "validation_failed", message: result.error }, meta: { correlationId, ts } },
        headers,
      );
    }

    return respond200(
      { ok: true, validation: result.data, meta: { correlationId, ts } },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "copilot_validate_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
