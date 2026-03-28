import "server-only";

/**
 * POST /api/command-center/acknowledge
 *
 * Allows a banker to acknowledge a queue item without suppressing urgency.
 * Acknowledgement only affects the "changed since viewed" signal.
 */

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    return NextResponse.json(
      { ok: false, error: "No bank context" },
      { status: 403 },
    );
  }

  let body: { dealId?: string; queueReasonCode?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  if (!body.dealId || !body.queueReasonCode) {
    return NextResponse.json(
      { ok: false, error: "dealId and queueReasonCode are required" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // Verify deal belongs to bank
  const { data: deal } = await sb
    .from("deals")
    .select("id")
    .eq("id", body.dealId)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (!deal) {
    return NextResponse.json(
      { ok: false, error: "Deal not found" },
      { status: 404 },
    );
  }

  const { error } = await sb.from("banker_queue_acknowledgements").insert({
    bank_id: bankId,
    user_id: userId,
    deal_id: body.dealId,
    queue_reason_code: body.queueReasonCode,
    note: body.note ?? null,
  });

  if (error) {
    console.error("[POST /api/command-center/acknowledge] error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to acknowledge" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
