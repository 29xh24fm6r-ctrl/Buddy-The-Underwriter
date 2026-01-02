import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { assertDealReady } from "@/lib/deals/assertDealReady";

export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[dealId]/submit
 * 
 * Submission Gate — Canonical Readiness Enforcement
 * 
 * - Blocks if ready_at IS NULL
 * - Records submitted_at timestamp
 * - Logs to pipeline ledger
 * - Returns human-readable error if not ready
 * 
 * This is the ONLY way to mark a deal as submitted.
 * No UI mutations, no manual overrides.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;
  const sb = supabaseAdmin();

  try {
    // 🔒 TENANT: Verify deal belongs to current bank
    const bankId = await getCurrentBankId();

    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id, bank_id, ready_at, ready_reason, submitted_at")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .single();

    if (dealError || !deal) {
      console.error("[submit] Deal not found or access denied", { dealId, bankId, dealError });
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    // ✅ Already submitted
    if (deal.submitted_at) {
      console.warn("[submit] Deal already submitted", { dealId, submitted_at: deal.submitted_at });
      return NextResponse.json({
        ok: true,
        already_submitted: true,
        submitted_at: deal.submitted_at,
      });
    }

    // 🚫 GATE: Assert readiness (throws if not ready)
    try {
      assertDealReady(deal);
    } catch (err: any) {
      console.warn("[submit] Deal not ready", { dealId, reason: err.message });
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          ready_at: deal.ready_at,
          ready_reason: deal.ready_reason,
        },
        { status: 409 } // Conflict: not ready
      );
    }

    // ✅ SUBMIT: Record submission timestamp
    const submittedAt = new Date().toISOString();

    const { error: updateError } = await sb
      .from("deals")
      .update({ submitted_at: submittedAt })
      .eq("id", dealId);

    if (updateError) {
      console.error("[submit] Failed to update submitted_at", { dealId, updateError });
      return NextResponse.json(
        { ok: false, error: "Failed to submit deal" },
        { status: 500 }
      );
    }

    // 🔥 LEDGER: Log submission event
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: bankId,
      stage: "submission",
      status: "completed",
      payload: {
        submitted_at: submittedAt,
        ready_at: deal.ready_at,
      },
    });

    console.log("[submit] Deal submitted successfully", { dealId, submittedAt });

    return NextResponse.json({
      ok: true,
      submitted_at: submittedAt,
    });
  } catch (err: any) {
    console.error("[submit] Unexpected error", { dealId, error: err.message });
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
