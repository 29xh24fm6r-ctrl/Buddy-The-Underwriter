import "server-only";

/**
 * Phase 65G — Auto-Advance Processor
 *
 * POST /api/admin/auto-advance/process
 *
 * Evaluates and executes deterministic stage advancement for active deals.
 * Auth: CRON_SECRET bearer token.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBuddyCanonicalState } from "@/core/state/BuddyCanonicalStateAdapter";
import { deriveBuddyExplanation } from "@/core/explanation/deriveBuddyExplanation";
import { deriveNextActions } from "@/core/actions/deriveNextActions";
import { evaluateAutoAdvance } from "@/core/auto-advance/evaluateAutoAdvance";
import { executeAutoAdvance } from "@/core/auto-advance/executeAutoAdvance";

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
      return NextResponse.json({ ok: true, processed: 0, advanced: 0 });
    }

    let processed = 0;
    let advanced = 0;
    let errors = 0;
    const advances: Array<{ dealId: string; from: string | null; to: string }> = [];

    for (const deal of deals) {
      try {
        const state = await getBuddyCanonicalState(deal.id);
        const explanation = deriveBuddyExplanation(state);
        const { nextActions } = deriveNextActions({
          canonicalState: state,
          explanation,
        });

        // Check borrower campaign completion
        const { data: openCampaigns } = await sb
          .from("borrower_request_campaigns")
          .select("id")
          .eq("deal_id", deal.id)
          .in("status", ["sent", "in_progress"]);

        const evaluation = evaluateAutoAdvance({
          canonicalStage: state.lifecycle,
          blockerCodes: state.blockers.map((b) => b.code),
          borrowerCampaignsComplete: (openCampaigns?.length ?? 0) === 0,
          nextActions,
        });

        if (evaluation.eligible) {
          const result = await executeAutoAdvance(deal.id, deal.bank_id, evaluation);
          if (result.advanced) {
            advanced++;
            advances.push({
              dealId: deal.id,
              from: result.fromStage,
              to: result.toStage!,
            });
          }
        }

        processed++;
      } catch (err) {
        console.warn(`[auto-advance/process] Error processing deal ${deal.id}:`, err);
        errors++;
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      totalDeals: deals.length,
      processed,
      advanced,
      errors,
      advances,
    });
  } catch (err) {
    console.error("[POST /api/admin/auto-advance/process] error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
