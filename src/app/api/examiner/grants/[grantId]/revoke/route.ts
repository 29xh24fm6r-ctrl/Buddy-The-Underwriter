import "server-only";

import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { revokeGrant } from "@/lib/examiner/examinerAccessGrants";
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

const ROUTE = "/api/examiner/grants/[grantId]/revoke";

/**
 * POST /api/examiner/grants/[grantId]/revoke
 *
 * Revoke an examiner access grant immediately.
 * Admin only.
 *
 * Body:
 *   reason: string
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ grantId: string }> },
) {
  const correlationId = generateCorrelationId("exg");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const { userId } = await requireRole(["super_admin", "bank_admin"]);
    const { grantId } = await ctx.params;

    const grantCheck = validateUuidParam(grantId, "grantId");
    if (!grantCheck.ok) {
      return respond200(
        {
          ok: false,
          error: { code: "invalid_grant_id", message: grantCheck.error!, correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const reason = body.reason || "No reason provided.";

    const success = await revokeGrant({
      grantId,
      revokedByUserId: userId,
      reason,
    });

    if (!success) {
      return respond200(
        {
          ok: false,
          error: { code: "revoke_failed", message: "Grant not found or already revoked.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    return respond200(
      {
        ok: true,
        revoked: true,
        grant_id: grantId,
        reason,
        meta: { correlationId, ts },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "revoke_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
