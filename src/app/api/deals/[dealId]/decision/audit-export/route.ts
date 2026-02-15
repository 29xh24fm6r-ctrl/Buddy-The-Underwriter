import "server-only";

import { NextResponse, NextRequest } from "next/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { buildCreditDecisionAuditSnapshot } from "@/lib/audit/buildCreditDecisionAuditSnapshot";
import { renderCreditDecisionAuditPdf } from "@/lib/audit/renderCreditDecisionAuditPdf";
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

const ROUTE = "/api/deals/[dealId]/decision/audit-export";

/**
 * GET /api/deals/[dealId]/decision/audit-export?snapshotId=...&format=json|pdf&as_of=<ISO>
 *
 * Canonical credit decision audit export endpoint (Phase F).
 *
 * Response shape:
 *   JSON: { ok, snapshot, snapshot_hash, generated_at }
 *   PDF:  { ok, data (base64), filename, contentType, snapshot_hash, generated_at }
 *
 * Headers: Content-Disposition: attachment, X-Buddy-Snapshot-Hash
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId("cdae");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRoleApi(["super_admin", "bank_admin"]);
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
    const format = url.searchParams.get("format") ?? "json";
    const asOf = url.searchParams.get("as_of") ?? undefined;

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

    if (format !== "json" && format !== "pdf") {
      return respond200(
        { ok: false, error: { code: "invalid_format", message: "format must be 'json' or 'pdf'" }, meta: { dealId, correlationId, ts } },
        headers,
      );
    }

    // Build snapshot
    let result;
    try {
      result = await buildCreditDecisionAuditSnapshot({
        dealId,
        bankId,
        snapshotId,
        asOf,
      });
    } catch (err: any) {
      const code = err?.message === "decision_snapshot_not_found" ? "decision_not_found" : "snapshot_build_failed";
      return respond200(
        { ok: false, error: { code, message: err?.message ?? "Failed to build decision audit snapshot" }, meta: { dealId, correlationId, ts } },
        headers,
      );
    }

    const { snapshot, snapshot_hash } = result;

    // Emit ledger event
    logLedgerEvent({
      dealId,
      bankId,
      eventKey: "buddy.decision.audit_snapshot_exported",
      uiState: "done",
      uiMessage: `Credit decision audit snapshot exported (${format})`,
      meta: { correlationId, snapshotId, format, snapshotHash: snapshot_hash },
    }).catch(() => {});

    // Canonical response headers
    const exportHeaders = {
      ...headers,
      "content-disposition": "attachment",
      "x-buddy-snapshot-hash": snapshot_hash,
    };

    // Return based on format
    if (format === "pdf") {
      const pdfBuffer = await renderCreditDecisionAuditPdf(snapshot, snapshot_hash);
      const filename = `Credit-Decision-Audit-${dealId.slice(0, 8)}-${ts.slice(0, 10)}.pdf`;

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

    // --- Omega belief augmentation (JSON only, read-only, non-blocking) ---
    let omegaState: unknown = null;
    let omegaAvailable = false;
    if (format === "json") {
      try {
        const { readOmegaState } = await import("@/lib/omega/readOmegaState");
        const omegaResult = await readOmegaState({
          stateType: "credit_decision",
          id: dealId,
          correlationId,
        });
        if (omegaResult.ok) {
          omegaState = omegaResult.data;
          omegaAvailable = true;
        }
      } catch {
        // Omega unavailable — export operates normally
      }
    }

    // JSON format
    return respond200(
      {
        ok: true,
        snapshot,
        snapshot_hash,
        generated_at: snapshot.meta.generated_at,
        omega_state: omegaState,
        omega_available: omegaAvailable,
      },
      exportHeaders,
    );
  } catch (err) {
    rethrowNextErrors(err);

    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: err.code },
        { status: err.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const safe = sanitizeError(err, "decision_audit_export_failed");
    return respond200(
      { ok: false, error: safe, meta: { dealId: "unknown", correlationId, ts } },
      headers,
    );
  }
}
