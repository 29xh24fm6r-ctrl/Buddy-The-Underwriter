import "server-only";

import { NextRequest } from "next/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { requireRole } from "@/lib/auth/requireRole";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { buildExaminerDropZip } from "@/lib/audit/buildExaminerDropZip";
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

const ROUTE = "/api/deals/[dealId]/examiner-drop";

/**
 * GET /api/deals/[dealId]/examiner-drop?snapshotId=...
 *
 * Canonical examiner drop ZIP endpoint (Phase G).
 *
 * Returns a self-contained regulatory examination package as a
 * base64-encoded ZIP in the sealed response envelope.
 *
 * Response shape:
 *   { ok, data (base64), filename, contentType, drop_hash, generated_at, manifest }
 *
 * Headers: Content-Disposition: attachment, X-Buddy-Drop-Hash
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId("exdrop");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRole(["super_admin", "bank_admin"]);
    const { dealId } = await ctx.params;

    const uuidCheck = validateUuidParam(dealId, "dealId");
    if (!uuidCheck.ok) {
      return respond200(
        { ok: false, error: { code: "invalid_deal_id", message: uuidCheck.error }, meta: { dealId: String(dealId), correlationId, ts } },
        headers,
      );
    }

    const bankId = await getCurrentBankId();
    const url = new URL(req.url);
    const snapshotId = url.searchParams.get("snapshotId") ?? "";

    if (!snapshotId) {
      return respond200(
        { ok: false, error: { code: "missing_snapshot_id", message: "snapshotId query parameter is required" }, meta: { dealId, correlationId, ts } },
        headers,
      );
    }

    const snapshotIdCheck = validateUuidParam(snapshotId, "snapshotId");
    if (!snapshotIdCheck.ok) {
      return respond200(
        { ok: false, error: { code: "invalid_snapshot_id", message: snapshotIdCheck.error }, meta: { dealId, correlationId, ts } },
        headers,
      );
    }

    // Build examiner drop ZIP
    let result;
    try {
      result = await buildExaminerDropZip({
        dealId,
        bankId,
        snapshotId,
      });
    } catch (err: any) {
      const msg = err?.message ?? "unknown";
      const code = msg.startsWith("deal_not_found") ? "deal_not_found"
        : msg.startsWith("decision_audit_build_failed") ? "decision_build_failed"
        : "examiner_drop_failed";
      return respond200(
        { ok: false, error: { code, message: msg }, meta: { dealId, correlationId, ts } },
        headers,
      );
    }

    const { zipBuffer, drop_hash, manifest } = result;

    // Emit ledger event
    logLedgerEvent({
      dealId,
      bankId,
      eventKey: "buddy.examiner.drop_exported",
      uiState: "done",
      uiMessage: "Examiner drop ZIP exported",
      meta: {
        correlationId,
        snapshotId,
        dropHash: drop_hash,
        artifactCount: manifest.artifacts.length,
      },
    }).catch(() => {});

    // Canonical response headers
    const exportHeaders = {
      ...headers,
      "content-disposition": "attachment",
      "x-buddy-drop-hash": drop_hash,
    };

    const filename = `Examiner-Drop-${dealId.slice(0, 8)}-${ts.slice(0, 10)}.zip`;

    return respond200(
      {
        ok: true,
        data: zipBuffer.toString("base64"),
        filename,
        contentType: "application/zip",
        drop_hash,
        generated_at: manifest.generated_at,
        manifest,
      },
      exportHeaders,
    );
  } catch (err) {
    const safe = sanitizeError(err, "examiner_drop_failed");
    return respond200(
      { ok: false, error: safe, meta: { dealId: "unknown", correlationId, ts } },
      headers,
    );
  }
}
