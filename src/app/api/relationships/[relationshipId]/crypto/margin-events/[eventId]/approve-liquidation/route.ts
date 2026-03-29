import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { approveCryptoLiquidation } from "@/core/relationship/cryptoServices";

export const runtime = "nodejs";

type Params = Promise<{ relationshipId: string; eventId: string }>;

export async function POST(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { relationshipId, eventId } = await ctx.params;

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

    const result = await approveCryptoLiquidation({
      marginEventId: eventId,
      relationshipId,
      bankId: bu.bank_id,
      approved: body.approved === true,
      actorUserId: userId,
      evidence: body.evidence,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
