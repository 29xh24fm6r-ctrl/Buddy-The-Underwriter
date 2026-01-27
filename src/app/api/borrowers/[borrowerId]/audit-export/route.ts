import "server-only";

import { NextRequest } from "next/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { requireRole } from "@/lib/auth/requireRole";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { buildBorrowerAuditSnapshot } from "@/lib/borrower/buildBorrowerAuditSnapshot";
import { renderBorrowerAuditPdf } from "@/lib/borrower/renderBorrowerAuditPdf";
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
 * GET /api/borrowers/[borrowerId]/audit-export?format=json|pdf&dealId=...
 *
 * Produces a tamper-evident audit snapshot for the given borrower.
 * Format: json (default) or pdf.
 * Optional dealId links to documents and ledger events for that deal.
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

    if (format !== "json" && format !== "pdf") {
      return respond200(
        { ok: false, error: { code: "invalid_format", message: "format must be 'json' or 'pdf'" }, meta: { borrowerId, correlationId, ts } },
        headers,
      );
    }

    // Build snapshot
    let snapshot;
    try {
      snapshot = await buildBorrowerAuditSnapshot({
        borrowerId,
        bankId,
        dealId,
      });
    } catch (err: any) {
      const code = err?.message === "borrower_not_found" ? "borrower_not_found" : "snapshot_build_failed";
      return respond200(
        { ok: false, error: { code, message: err?.message ?? "Failed to build snapshot" }, meta: { borrowerId, correlationId, ts } },
        headers,
      );
    }

    // Emit ledger event (non-blocking)
    if (dealId) {
      logLedgerEvent({
        dealId,
        bankId,
        eventKey: "buddy.borrower.audit_snapshot_exported",
        uiState: "done",
        uiMessage: `Borrower audit snapshot exported (${format})`,
        meta: { correlationId, borrowerId, format, snapshotHash: snapshot.snapshot_hash },
      }).catch(() => {});
    }

    // Return based on format
    if (format === "pdf") {
      const pdfBuffer = await renderBorrowerAuditPdf(snapshot);
      const filename = `Borrower-Audit-${(snapshot.borrower.legal_name ?? "Unknown").replace(/\s+/g, "-")}-${ts.slice(0, 10)}.pdf`;

      return respond200(
        {
          ok: true,
          data: pdfBuffer.toString("base64"),
          filename,
          contentType: "application/pdf",
          snapshotHash: snapshot.snapshot_hash,
          meta: { borrowerId, correlationId, ts },
        },
        headers,
      );
    }

    // JSON format
    return respond200(
      {
        ok: true,
        snapshot,
        snapshotHash: snapshot.snapshot_hash,
        meta: { borrowerId, correlationId, ts },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "audit_export_failed");
    return respond200(
      { ok: false, error: safe, meta: { borrowerId: "unknown", correlationId, ts } },
      headers,
    );
  }
}
