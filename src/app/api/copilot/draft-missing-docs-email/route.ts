/**
 * Banker Copilot: Draft Missing Docs Email
 *
 * POST /api/copilot/draft-missing-docs-email { caseId }
 *
 * Generates a plain-text email draft listing missing documents.
 * Draft-only — does NOT send any email.
 * Banker mode only.
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
import { canGenerateDraftEmails } from "@/lib/modes/gates";
import { getBuddyMode } from "@/lib/modes/mode";
import { handleGenerateMissingDocsEmail } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

const ROUTE = "/api/copilot/draft-missing-docs-email";

export async function POST(req: NextRequest) {
  const correlationId = generateCorrelationId("cop-e");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const bankId = await getCurrentBankId();
    const mode = getBuddyMode();
    if (!canGenerateDraftEmails(mode)) {
      return respond200(
        { ok: false, error: { code: "mode_denied", message: "Draft email generation not available in this mode." }, meta: { correlationId, ts } },
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

    const result = await handleGenerateMissingDocsEmail(caseId, bankId);

    // Ledger the action (non-blocking)
    try {
      const { writeBuddySignal } = await import("@/buddy/server/writeBuddySignal");
      await writeBuddySignal({
        type: "user.action",
        ts: Date.now(),
        source: "copilot/draft-email",
        dealId: caseId,
        payload: { correlationId, action: "generate_missing_docs_email", result_ok: result.ok },
      });
    } catch { /* non-blocking */ }

    if (!result.ok) {
      return respond200(
        { ok: false, error: { code: "email_gen_failed", message: result.error }, meta: { correlationId, ts } },
        headers,
      );
    }

    return respond200(
      { ok: true, draft: result.data, meta: { correlationId, ts } },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "copilot_email_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
