import "server-only";

import { NextRequest } from "next/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { requireRole } from "@/lib/auth/requireRole";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { buildBorrowerAuditSnapshot } from "@/lib/audit/buildBorrowerAuditSnapshot";
import { renderBorrowerAuditPdf } from "@/lib/audit/renderBorrowerAuditPdf";
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

const ROUTE = "/api/borrowers/[borrowerId]/audit-export";

/**
 * GET /api/borrowers/[borrowerId]/audit-export?format=json|pdf&as_of=<ISO>&dealId=...
 *
 * Canonical audit export endpoint (Phase E).
 *
 * Response shape:
 *   JSON: { snapshot, snapshot_hash, generated_at }
 *   PDF:  { data (base64), filename, contentType, snapshot_hash, generated_at }
 *
 * Headers: Content-Disposition: attachment, X-Buddy-Snapshot-Hash
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ borrowerId: string }> }) {
  const correlationId = generateCorrelationId("bae");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRole(["super_admin", "bank_admin"]);
    const { borrowerId } = await ctx.params;

    const uuidCheck = validateUuidParam(borrowerId, "borrowerId");
    if (!uuidCheck.ok) {
      return respond200(
        { ok: false, error: { code: "invalid_borrower_id", message: uuidCheck.error }, meta: { borrowerId: String(borrowerId), correlationId, ts } },
        headers,
      );
    }

    const bankId = await getCurrentBankId();
    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "json";
    const dealId = url.searchParams.get("dealId") ?? null;
    const asOf = url.searchParams.get("as_of") ?? undefined;

    if (format !== "json" && format !== "pdf") {
      return respond200(
        { ok: false, error: { code: "invalid_format", message: "format must be 'json' or 'pdf'" }, meta: { borrowerId, correlationId, ts } },
        headers,
      );
    }

    // Build snapshot
    let result;
    try {
      result = await buildBorrowerAuditSnapshot({
        borrowerId,
        bankId,
        dealId,
        asOf,
      });
    } catch (err: any) {
      const code = err?.message === "borrower_not_found" ? "borrower_not_found" : "snapshot_build_failed";
      return respond200(
        { ok: false, error: { code, message: err?.message ?? "Failed to build snapshot" }, meta: { borrowerId, correlationId, ts } },
        headers,
      );
    }

    const { snapshot, snapshot_hash } = result;

    // Emit ledger event — exactly once per export
    if (dealId) {
      logLedgerEvent({
        dealId,
        bankId,
        eventKey: "buddy.borrower.audit_snapshot_exported",
        uiState: "done",
        uiMessage: `Borrower audit snapshot exported (${format})`,
        meta: { correlationId, borrowerId, format, snapshotHash: snapshot_hash },
      }).catch(() => {});
    }

    // Canonical response headers
    const exportHeaders = {
      ...headers,
      "content-disposition": "attachment",
      "x-buddy-snapshot-hash": snapshot_hash,
    };

    // Return based on format
    if (format === "pdf") {
      const pdfBuffer = await renderBorrowerAuditPdf(snapshot, snapshot_hash);
      const filename = `Borrower-Audit-${(snapshot.borrower.legal_name || "Unknown").replace(/\s+/g, "-")}-${ts.slice(0, 10)}.pdf`;

      return respond200(
        {
          ok: true,
          data: pdfBuffer.toString("base64"),
          filename,
          contentType: "application/pdf",
          snapshot_hash,
          generated_at: snapshot.meta.generated_at,
        },
        exportHeaders,
      );
    }

    // JSON format
    return respond200(
      {
        ok: true,
        snapshot,
        snapshot_hash,
        generated_at: snapshot.meta.generated_at,
      },
      exportHeaders,
    );
  } catch (err) {
    const safe = sanitizeError(err, "audit_export_failed");
    return respond200(
      { ok: false, error: safe, meta: { borrowerId: "unknown", correlationId, ts } },
      headers,
    );
  }
}
