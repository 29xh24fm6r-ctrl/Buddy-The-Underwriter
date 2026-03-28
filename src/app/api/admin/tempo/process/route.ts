import "server-only";

/**
 * Phase 65G — Tempo Processor
 *
 * POST /api/admin/tempo/process
 *
 * Computes SLA snapshots, derives urgency, detects stuckness,
 * and persists escalation events for all active deals.
 * Auth: CRON_SECRET bearer token.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBuddyCanonicalState } from "@/core/state/BuddyCanonicalStateAdapter";
import { deriveBuddyExplanation } from "@/core/explanation/deriveBuddyExplanation";
import { deriveNextActions } from "@/core/actions/deriveNextActions";
import { deriveDealAgingSnapshot } from "@/core/sla/deriveDealAgingSnapshot";
import { deriveEscalationCandidates } from "@/core/sla/deriveEscalationCandidates";
import { persistEscalationCandidates } from "@/core/sla/persistEscalationCandidates";
import { writeSlaSnapshot } from "@/core/sla/writeSlaSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();

    // Fetch active deals (not closed/workout)
    const { data: deals } = await sb
      .from("deals")
      .select("id, bank_id, lifecycle_stage")
      .not("lifecycle_stage", "in", '("closed","workout")')
      .limit(200);

    if (!deals || deals.length === 0) {
      return NextResponse.json({ ok: true, processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const deal of deals) {
      try {
        const state = await getBuddyCanonicalState(deal.id);
        const explanation = deriveBuddyExplanation(state);
        const { primaryAction } = deriveNextActions({
          canonicalState: state,
          explanation,
        });

        const snapshot = await deriveDealAgingSnapshot({
          dealId: deal.id,
          canonicalStage: state.lifecycle,
          blockerCodes: state.blockers.map((b) => b.code),
          primaryAction,
        });

        await writeSlaSnapshot(snapshot, deal.bank_id);

        const escalations = deriveEscalationCandidates(snapshot);
        await persistEscalationCandidates(deal.id, deal.bank_id, escalations);

        processed++;
      } catch (err) {
        console.warn(`[tempo/process] Error processing deal ${deal.id}:`, err);
        errors++;
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      totalDeals: deals.length,
      processed,
      errors,
    });
  } catch (err) {
    console.error("[POST /api/admin/tempo/process] error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
