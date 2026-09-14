import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { loadFinancialSnapshotValidation } from "@/lib/financial/snapshot/getFinancialSnapshotGate";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/financial-validation
 *
 * Returns the active financial snapshot with facts, readiness, and completeness.
 * Auth: Clerk session + deal cockpit access.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const validation = await loadFinancialSnapshotValidation(dealId, { bankId: auth.bankId });
  const { snapshot, gate } = validation;
  if (gate.evaluationStatus === "unavailable") {
    return NextResponse.json({ ok: false, error: gate.message, gate }, { status: 503 });
  }
  const snapshotStatus = snapshot ? (gate.blockerCode === "financial_snapshot_stale" ? "stale" : gate.ready ? "validated" : "needs_review") : "not_started";
  return NextResponse.json({
    ok: true,
    source: "financial_snapshots",
    snapshot: snapshot ? { ...snapshot, status: snapshotStatus } : null,
    facts: [],
    gate,
    readiness: {
      snapshotStatus,
      completenessPercent: validation.completenessPercent,
      criticalMissingFacts: validation.missingRequiredKeys,
      unresolvedConflicts: [],
      unresolvedConflictCount: gate.evidence.unresolvedConflicts,
      staleReasons: gate.blockerCode === "financial_snapshot_stale" ? [gate.message] : [],
      reviewRequired: !gate.ready,
      decisionSafe: gate.ready,
      memoSafe: gate.ready,
      nextRecommendedAction: gate.message ?? "Financial snapshot complete.",
    },
  });
}
