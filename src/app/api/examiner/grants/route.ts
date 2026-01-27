import "server-only";

import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import {
  createExaminerGrant,
  getGrantsForBank,
} from "@/lib/examiner/examinerAccessGrants";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/examiner/grants";

/**
 * GET /api/examiner/grants
 *
 * List all examiner access grants for the current bank.
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const correlationId = generateCorrelationId("exg");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const { userId } = await requireRole(["super_admin", "bank_admin"]);
    const bankId = await getCurrentBankId();

    const url = new URL(req.url);
    const includeInactive = url.searchParams.get("include_inactive") === "true";

    const grants = await getGrantsForBank(bankId, includeInactive);

    return respond200(
      {
        ok: true,
        grants,
        meta: { correlationId, ts, bankId },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "grants_list_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}

/**
 * POST /api/examiner/grants
 *
 * Create a new examiner access grant.
 * Admin only.
 *
 * Body:
 *   examiner_name: string
 *   organization: string
 *   deal_ids: string[]
 *   read_areas: string[]
 *   expires_in_hours: number (default 72)
 */
export async function POST(req: NextRequest) {
  const correlationId = generateCorrelationId("exg");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const { userId } = await requireRole(["super_admin", "bank_admin"]);
    const bankId = await getCurrentBankId();

    let body: any;
    try {
      body = await req.json();
    } catch {
      return respond200(
        {
          ok: false,
          error: { code: "invalid_body", message: "Request body must be valid JSON.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    const examinerName = body.examiner_name;
    const organization = body.organization;
    const dealIds = Array.isArray(body.deal_ids) ? body.deal_ids : [];
    const readAreas = Array.isArray(body.read_areas) ? body.read_areas : ["all"];
    const expiresInHours = Number(body.expires_in_hours) || 72;

    if (!examinerName || !organization) {
      return respond200(
        {
          ok: false,
          error: { code: "missing_fields", message: "examiner_name and organization are required.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

    const grant = await createExaminerGrant({
      examinerName,
      organization,
      bankId,
      scope: { deal_ids: dealIds, read_areas: readAreas },
      grantedByUserId: userId,
      expiresAt,
    });

    if (!grant) {
      return respond200(
        {
          ok: false,
          error: { code: "grant_creation_failed", message: "Failed to create examiner grant.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    return respond200(
      {
        ok: true,
        grant,
        meta: { correlationId, ts, bankId },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "grant_creation_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
