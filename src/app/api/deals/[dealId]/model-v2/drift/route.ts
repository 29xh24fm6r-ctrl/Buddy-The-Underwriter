/**
 * Phase 13 — Deal-Level Registry Drift Endpoint
 *
 * GET /api/deals/[dealId]/model-v2/drift
 *
 * Compares the deal's latest snapshot registry version to the current live binding.
 */

import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadLatestSnapshot } from "@/lib/modelEngine/snapshotService";
import { resolveRegistryBinding } from "@/lib/metrics/registry/selectActiveVersion";
import { detectRegistryDrift } from "@/lib/modelEngine/snapshot/detectDrift";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "unauthorized" ? 401
      : access.error === "tenant_mismatch" ? 403 : 404;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const { bankId } = access;
  const sb = supabaseAdmin();

  // Load latest snapshot + current binding (bank-aware)
  const snapshot = await loadLatestSnapshot(sb, dealId);
  const currentBinding = await resolveRegistryBinding(sb, bankId);

  const drift = detectRegistryDrift(snapshot, currentBinding);

  // Emit telemetry if drift detected
  if (drift.hasDrift) {
    emitV2Event({
      code: V2_EVENT_CODES.METRIC_REGISTRY_DRIFT_DETECTED,
      dealId,
      bankId,
      payload: {
        snapshotVersion: drift.snapshotVersion,
        currentVersion: drift.currentVersion,
        severity: drift.driftSeverity,
        reason: drift.reason,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    drift,
    checkedAt: new Date().toISOString(),
  });
}
