import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateBorrowerNudge, shouldSendNudge, recordNudgeSent } from "@/lib/borrower/nudges";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/nudges/batch
 * 
 * Batch process nudges for all active deals
 * 
 * This would typically be called by a cron job:
 * - Every 24 hours
 * - Finds all deals that are not ready and not submitted
 * - Generates + sends nudges based on blockers
 * - Rate-limits to prevent spam
 */
export async function POST(req: NextRequest) {
  const sb = supabaseAdmin();

  try {
    // TODO: Add requireSuperAdmin() when in production
    // For now, allow testing

    // Find all deals that need nudging
    const { data: deals } = await sb
      .from("deals")
      .select("id, borrower_name, borrower_email, bank_id")
      .is("ready_at", null)
      .is("submitted_at", null)
      .order("created_at", { ascending: true })
      .limit(100); // Process in batches

    if (!deals || deals.length === 0) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        sent: 0,
        skipped: 0,
      });
    }

    let sent = 0;
    let skipped = 0;

    for (const deal of deals) {
      try {
        // Check rate limit
        const shouldSend = await shouldSendNudge(deal.id);
        if (!shouldSend) {
          skipped++;
          continue;
        }

        // Generate nudge
        const nudge = await generateBorrowerNudge(deal.id);
        if (!nudge) {
          skipped++;
          continue;
        }

        // Skip low-urgency nudges in batch processing
        if (nudge.urgency === "low") {
          skipped++;
          continue;
        }

        // TODO: Actually send via email/SMS
        console.log("[batch-nudge] Would send", {
          deal_id: deal.id,
          borrower: deal.borrower_name,
          email: deal.borrower_email,
          message: nudge.message,
        });

        // Record nudge
        await recordNudgeSent(deal.id, nudge);

        // Log to ledger
        await sb.from("deal_pipeline_ledger").insert({
          deal_id: deal.id,
          bank_id: deal.bank_id,
          stage: "communication",
          status: "completed",
          payload: {
            nudge_type: nudge.nudge_type,
            urgency: nudge.urgency,
            batch_processing: true,
          },
        });

        sent++;
      } catch (err: any) {
        console.error("[batch-nudge] Failed for deal", {
          deal_id: deal.id,
          error: err.message,
        });
        skipped++;
      }
    }

    return NextResponse.json({
      ok: true,
      processed: deals.length,
      sent,
      skipped,
    });
  } catch (err: any) {
    console.error("[batch-nudge] Error", { error: err.message });
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
