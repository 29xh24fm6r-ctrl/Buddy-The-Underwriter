import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import type { BuddySignalBase } from "@/buddy/signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const bankId = await getCurrentBankId();
    const body = (await req.json().catch(() => null)) as BuddySignalBase | null;

    if (!body || !body.type || !body.source) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    await sb.from("buddy_signal_ledger").insert({
      bank_id: bankId,
      deal_id: body.dealId ?? null,
      type: body.type,
      source: body.source,
      payload: body.payload ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "unhandled_error" },
      { status: 500 },
    );
  }
}
