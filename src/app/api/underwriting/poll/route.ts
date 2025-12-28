import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/underwriting/poll
 * 
 * Polls all active deals and checks if underwriting_ready should be set to true.
 * This can be called via cron (e.g., Vercel Cron) to auto-update underwriting status.
 * 
 * Logic:
 * - Find all deals where underwriting_ready = false AND stage = 'underwriting'
 * - For each deal, check if all required checklist items are received
 * - If yes, set underwriting_ready = true and create notification
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    // Optional: Protect with secret (for Vercel Cron)
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    // Get all deals that are not yet underwriting_ready
    const { data: deals, error: dealsErr } = await sb
      .from("deals")
      .select("id, name, stage")
      .eq("underwriting_ready", false)
      .eq("stage", "underwriting");

    if (dealsErr) {
      console.error("Poll deals error:", dealsErr);
      return NextResponse.json(
        { error: dealsErr.message },
        { status: 500 }
      );
    }

    const updates: string[] = [];

    for (const deal of deals || []) {
      // Check if all required items are received
      const { data: items } = await sb
        .from("deal_checklist_items")
        .select("id, required")
        .eq("deal_id", deal.id);

      if (!items || items.length === 0) continue;

      const requiredItems = items.filter((i) => i.required);
      if (requiredItems.length === 0) continue;

      // Check if all required items have at least one confirmed submission
      let allReceived = true;
      for (const item of requiredItems) {
        const { data: subs } = await sb
          .from("doc_submissions")
          .select("id")
          .eq("deal_id", deal.id)
          .eq("checklist_item_id", item.id)
          .eq("confirmed", true)
          .limit(1);

        if (!subs || subs.length === 0) {
          allReceived = false;
          break;
        }
      }

      if (allReceived) {
        // Mark deal as underwriting_ready
        await sb
          .from("deals")
          .update({ underwriting_ready: true })
          .eq("id", deal.id);

        // Create notification
        await sb.from("notifications").insert({
          deal_id: deal.id,
          type: "underwriting_ready",
          title: "Ready for Underwriting",
          message: `All required documents received for ${deal.name}`,
        });

        updates.push(deal.id);
      }
    }

    return NextResponse.json({
      ok: true,
      checked: deals?.length || 0,
      updated: updates.length,
      deal_ids: updates,
    });
  } catch (error: any) {
    console.error("Poll error:", error);
    return NextResponse.json(
      { error: error?.message || "Poll failed" },
      { status: 500 }
    );
  }
}
