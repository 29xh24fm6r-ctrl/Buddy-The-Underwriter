import "server-only";

/**
 * Phase 65G — Deal Tempo API
 *
 * GET /api/deals/[dealId]/tempo
 *
 * Returns SLA aging snapshot, active escalations, and auto-advance evaluation.
 */

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { getBuddyCanonicalState } from "@/core/state/BuddyCanonicalStateAdapter";
import { deriveBuddyExplanation } from "@/core/explanation/deriveBuddyExplanation";
import { deriveNextActions } from "@/core/actions/deriveNextActions";
import { deriveDealAgingSnapshot } from "@/core/sla/deriveDealAgingSnapshot";
import { deriveEscalationCandidates } from "@/core/sla/deriveEscalationCandidates";
import { evaluateAutoAdvance } from "@/core/auto-advance/evaluateAutoAdvance";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
  }

  try {
    // Derive canonical package
    const canonicalState = await getBuddyCanonicalState(dealId);
    const explanation = deriveBuddyExplanation(canonicalState);
    const { nextActions, primaryAction } = deriveNextActions({
      canonicalState,
      explanation,
    });

    // Derive aging snapshot
    const snapshot = await deriveDealAgingSnapshot({
      dealId,
      canonicalStage: canonicalState.lifecycle,
      blockerCodes: canonicalState.blockers.map((b) => b.code),
      primaryAction,
    });

    // Derive escalation candidates
    const escalationCandidates = deriveEscalationCandidates(snapshot);

    // Fetch active escalations from DB
    const sb = supabaseAdmin();
    const { data: activeEscalations } = await sb
      .from("deal_escalation_events")
      .select("id, escalation_code, severity, message, first_triggered_at, last_triggered_at")
      .eq("deal_id", dealId)
      .eq("is_active", true)
      .order("last_triggered_at", { ascending: false });

    // Check borrower campaign completion for auto-advance
    const { data: openCampaigns } = await sb
      .from("borrower_request_campaigns")
      .select("id")
      .eq("deal_id", dealId)
      .in("status", ["sent", "in_progress"]);

    const autoAdvance = evaluateAutoAdvance({
      canonicalStage: canonicalState.lifecycle,
      blockerCodes: canonicalState.blockers.map((b) => b.code),
      borrowerCampaignsComplete: (openCampaigns?.length ?? 0) === 0,
      nextActions,
    });

    return NextResponse.json({
      ok: true,
      snapshot,
      activeEscalations: activeEscalations ?? [],
      autoAdvance,
    });
  } catch (err) {
    console.error("[GET /api/deals/[dealId]/tempo] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal", reason: String(err) },
      { status: 500 },
    );
  }
}
