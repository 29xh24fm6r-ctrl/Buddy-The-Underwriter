/**
 * SPEC-10 — DELETE /api/deals/[dealId]/advisor/feedback/[signalKey]
 *
 * Clears a single feedback row. Mirrors a `advisor_signal_feedback_cleared`
 * event into buddy_signal_ledger.
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; signalKey: string }> };

function isMissingTableError(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    /relation\s+"?buddy_advisor_feedback"?\s+does not exist/i.test(message) ||
    /could not find the table/i.test(message) ||
    /table\s+not\s+found/i.test(message)
  );
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { userId } = await clerkAuth().catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    return NextResponse.json(
      { ok: false, error: "no_bank_context" },
      { status: 403 },
    );
  }

  const { dealId, signalKey } = await ctx.params;
  const decodedKey = decodeURIComponent(signalKey);

  if (!decodedKey) {
    return NextResponse.json(
      { ok: false, error: "missing_signal_key" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const del = await (sb as any)
    .from("buddy_advisor_feedback")
    .delete()
    .eq("bank_id", bankId)
    .eq("deal_id", dealId)
    .eq("user_id", userId)
    .eq("signal_key", decodedKey);

  if (del.error) {
    if (isMissingTableError(del.error.message)) {
      return NextResponse.json({ ok: false, error: "table_missing" });
    }
    return NextResponse.json(
      { ok: false, error: del.error.message },
      { status: 500 },
    );
  }

  try {
    await (sb as any).from("buddy_signal_ledger").insert({
      bank_id: bankId,
      deal_id: dealId,
      type: "advisor_signal_feedback_cleared",
      source: "stage_cockpit",
      payload: { signalKey: decodedKey },
    });
  } catch {
    // non-fatal
  }

  return NextResponse.json({ ok: true });
}
