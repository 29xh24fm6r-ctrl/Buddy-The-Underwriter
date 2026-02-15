import "server-only";

import { NextResponse, NextRequest } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { sha256 } from "@/lib/security/tokens";
import { stableStringify } from "@/lib/audit/buildBorrowerAuditSnapshot";
import { generateExaminerPlaybooks } from "@/lib/examiner/playbookGenerator";
import { renderPlaybooksPdf } from "@/lib/examiner/renderPlaybooksPdf";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/examiner/playbooks";

/**
 * GET /api/examiner/playbooks?format=json|pdf
 *
 * Returns the complete examiner playbook bundle:
 *  - 7 self-contained playbooks in regulator tone
 *  - Deterministic hash for integrity verification
 *
 * Formats:
 *  - json: Full playbook object with hash
 *  - pdf: Base64-encoded PDF document
 *
 * Sealed: always HTTP 200, errors in body.
 */
export async function GET(req: NextRequest) {
  const correlationId = generateCorrelationId("pbk");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRoleApi(["super_admin", "bank_admin"]);

    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") ?? "json";

    if (format !== "json" && format !== "pdf") {
      return respond200(
        {
          ok: false,
          error: {
            code: "invalid_format",
            message: `Invalid format "${format}". Must be "json" or "pdf".`,
            correlationId,
          },
          meta: { correlationId, ts },
        },
        { ...headers, "content-disposition": "attachment" } as any,
      );
    }

    // Generate playbooks (static, deterministic)
    const playbooks = generateExaminerPlaybooks();
    const playbookJson = stableStringify(playbooks);
    const playbookHash = sha256(playbookJson);

    if (format === "pdf") {
      const pdfBuffer = await renderPlaybooksPdf(playbooks, playbookHash);
      const pdfBase64 = pdfBuffer.toString("base64");

      return respond200(
        {
          ok: true,
          data: pdfBase64,
          filename: `examiner-playbooks-v${playbooks.playbook_version}.pdf`,
          contentType: "application/pdf",
          playbook_hash: playbookHash,
          generated_at: playbooks.generated_at,
          meta: { correlationId, ts },
        },
        {
          ...headers,
          "content-disposition": "attachment",
          "x-buddy-playbook-hash": playbookHash,
        } as any,
      );
    }

    // JSON format
    return respond200(
      {
        ok: true,
        playbooks,
        playbook_hash: playbookHash,
        generated_at: playbooks.generated_at,
        meta: { correlationId, ts },
      },
      {
        ...headers,
        "content-disposition": "attachment",
        "x-buddy-playbook-hash": playbookHash,
      } as any,
    );
  } catch (err) {
    rethrowNextErrors(err);

    if (err instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: err.code },
        { status: err.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const safe = sanitizeError(err, "playbook_export_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
