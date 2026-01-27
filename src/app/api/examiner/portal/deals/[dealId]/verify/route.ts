import "server-only";

import { NextRequest } from "next/server";
import {
  getActiveGrant,
  validateGrantScope,
  logExaminerActivity,
} from "@/lib/examiner/examinerAccessGrants";
import {
  verifySnapshotHash,
  computeSnapshotHash,
} from "@/lib/integrity/verifySnapshot";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stableStringify } from "@/lib/audit/buildBorrowerAuditSnapshot";
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

const ROUTE = "/api/examiner/portal/deals/[dealId]/verify";

/**
 * GET /api/examiner/portal/deals/[dealId]/verify?grant_id=...&snapshot_id=...
 *
 * Inline integrity verification for examiners.
 * Recomputes snapshot hash and compares against stored value.
 * Every verification attempt is logged.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const correlationId = generateCorrelationId("exvf");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    const { dealId } = await ctx.params;
    const url = new URL(req.url);
    const grantId = url.searchParams.get("grant_id") ?? "";
    const snapshotId = url.searchParams.get("snapshot_id") ?? "";

    // Validate params
    const dealCheck = validateUuidParam(dealId, "dealId");
    if (!dealCheck.ok) {
      return respond200(
        {
          ok: false,
          error: { code: "invalid_deal_id", message: dealCheck.error!, correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    const grantCheck = validateUuidParam(grantId, "grant_id");
    if (!grantCheck.ok) {
      return respond200(
        {
          ok: false,
          error: { code: "invalid_grant_id", message: "A valid grant_id is required.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    // Validate grant
    const grant = await getActiveGrant(grantId);
    if (!grant) {
      return respond200(
        {
          ok: false,
          error: { code: "grant_not_found", message: "Grant not found, expired, or revoked.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    const scopeCheck = validateGrantScope(grant, dealId, "audit");
    if (!scopeCheck.allowed) {
      return respond200(
        {
          ok: false,
          error: { code: "scope_denied", message: scopeCheck.reason, correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    // Load decision snapshot for verification
    const sb = supabaseAdmin();
    let snapQuery = sb
      .from("decision_snapshots")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", grant.bank_id);

    if (snapshotId) {
      snapQuery = snapQuery.eq("id", snapshotId);
    } else {
      snapQuery = snapQuery.order("created_at", { ascending: false }).limit(1);
    }

    const { data: snapRaw } = await snapQuery.maybeSingle();

    if (!snapRaw) {
      return respond200(
        {
          ok: false,
          error: { code: "snapshot_not_found", message: "Decision snapshot not found.", correlationId },
          meta: { correlationId, ts },
        },
        headers,
      );
    }

    const snap = snapRaw as any;

    // Compute current hash
    const snapshotForHash = {
      decision_json: snap.decision_json,
      inputs_json: snap.inputs_json,
      policy_eval_json: snap.policy_eval_json,
      exceptions_json: snap.exceptions_json,
      confidence: snap.confidence,
      status: snap.status,
    };

    const currentHash = computeSnapshotHash(snapshotForHash);
    const storedHash = snap.snapshot_hash ?? snap.hash ?? null;

    const verificationResult = storedHash
      ? verifySnapshotHash({
          snapshot: snapshotForHash,
          expectedHash: storedHash,
          artifactType: "decision_snapshot",
          artifactId: snap.id,
        })
      : {
          check_version: "1.0" as const,
          checked_at: ts,
          artifact_type: "decision_snapshot",
          artifact_id: snap.id,
          expected_hash: "(no stored hash)",
          computed_hash: currentHash,
          match: false,
          details: "No stored hash available for comparison. Hash computed from current data.",
        };

    // Log verification activity (non-blocking)
    await logExaminerActivity({
      grant_id: grantId,
      action: "verified_integrity",
      deal_id: dealId,
      detail: {
        snapshot_id: snap.id,
        match: verificationResult.match,
        correlationId,
      },
    });

    return respond200(
      {
        ok: true,
        verification: verificationResult,
        meta: { correlationId, ts, dealId },
      },
      headers,
    );
  } catch (err) {
    const safe = sanitizeError(err, "verification_failed");
    return respond200(
      { ok: false, error: safe, meta: { correlationId, ts } },
      headers,
    );
  }
}
