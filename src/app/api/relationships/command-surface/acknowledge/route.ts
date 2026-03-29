import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/relationships/command-surface/acknowledge
 * Writes an acknowledgement — affects changedSinceViewed only, never suppresses urgency.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    const { data: bu } = await sb
      .from("bank_users")
      .select("bank_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!bu) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    if (!body.relationshipId || !body.primaryReasonCode) {
      return NextResponse.json(
        { ok: false, error: "relationshipId and primaryReasonCode are required" },
        { status: 400 },
      );
    }

    const { error } = await sb
      .from("relationship_surface_acknowledgements")
      .insert({
        relationship_id: body.relationshipId,
        bank_id: bu.bank_id,
        user_id: userId,
        primary_reason_code: body.primaryReasonCode,
        note: body.note ?? null,
      });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
