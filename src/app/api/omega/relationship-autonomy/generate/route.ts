import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateRelationshipAutonomyPlan } from "@/core/omega-autonomy/generateRelationshipAutonomyPlan";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();
    const { data: bu } = await sb.from("bank_users").select("bank_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!bu) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const relationshipId = new URL(req.url).searchParams.get("relationshipId");
    if (!relationshipId) return NextResponse.json({ ok: false, error: "relationshipId required" }, { status: 400 });

    const result = await generateRelationshipAutonomyPlan({
      relationshipId,
      bankId: bu.bank_id,
      userId,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
