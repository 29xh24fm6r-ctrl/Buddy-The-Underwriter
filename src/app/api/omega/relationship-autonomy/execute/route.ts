import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { executeRelationshipAutonomyPlan } from "@/core/omega-autonomy/executeRelationshipAutonomyPlan";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();
    const { data: bu } = await sb.from("bank_users").select("bank_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!bu) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    if (!body.planId) return NextResponse.json({ ok: false, error: "planId required" }, { status: 400 });

    const result = await executeRelationshipAutonomyPlan({
      planId: body.planId,
      bankId: bu.bank_id,
      userId,
      approvedActionIds: body.approvedActionIds,
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
