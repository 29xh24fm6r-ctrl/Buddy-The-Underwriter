import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateBorrowerNudge, shouldSendNudge, recordNudgeSent } from "@/lib/borrower/nudges";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[dealId]/nudge
 * 
 * Manually trigger borrower nudge generation + delivery
 * (In production, this would be called by a scheduled job)
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;
  const sb = supabaseAdmin();

  try {
    const bankId = await getCurrentBankId();

    // Verify deal exists and belongs to bank
    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id, borrower_email, borrower_phone")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .single();

    if (!deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    // Check if nudge should be sent (rate limiting)
    const shouldSend = await shouldSendNudge(dealId);
    if (!shouldSend) {
      return NextResponse.json({
        ok: true,
        nudge_sent: false,
        reason: "Nudge sent recently (within 24h)",
      });
    }

    // Generate nudge based on current blockers
    const nudge = await generateBorrowerNudge(dealId);

    if (!nudge) {
      return NextResponse.json({
        ok: true,
        nudge_sent: false,
        reason: "No nudge needed (deal submitted or no blockers)",
      });
    }

    // TODO: Actually send via email/SMS
    // For now, just log and record
    console.log("[nudge] Would send to borrower", {
      dealId,
      email: deal.borrower_email,
      phone: deal.borrower_phone,
      message: nudge.message,
      action_items: nudge.action_items,
    });

    // Record that nudge was sent
    await recordNudgeSent(dealId, nudge);

    // Log to pipeline ledger
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: bankId,
      stage: "communication",
      status: "completed",
      payload: {
        nudge_type: nudge.nudge_type,
        urgency: nudge.urgency,
        action_items_count: nudge.action_items.length,
      },
    });

    return NextResponse.json({
      ok: true,
      nudge_sent: true,
      nudge: {
        type: nudge.nudge_type,
        message: nudge.message,
        action_items: nudge.action_items,
        urgency: nudge.urgency,
      },
    });
  } catch (err: any) {
    console.error("[nudge] Error", { dealId, error: err.message });
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/deals/[dealId]/nudge
 * 
 * Preview what nudge would be sent (without actually sending)
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;

  try {
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Verify access
    const { data: deal } = await sb
      .from("deals")
      .select("id")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .single();

    if (!deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    const nudge = await generateBorrowerNudge(dealId);
    const shouldSend = await shouldSendNudge(dealId);

    return NextResponse.json({
      ok: true,
      nudge: nudge || null,
      should_send: shouldSend,
    });
  } catch (err: any) {
    console.error("[nudge] Preview error", { dealId, error: err.message });
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
