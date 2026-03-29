import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logRelationshipAutonomyEvent } from "@/core/omega-autonomy/logRelationshipAutonomyEvent";

export const runtime = "nodejs";

const VALID_MODES = ["manual", "assistive", "precommit_review", "controlled_autonomy"];

export async function POST(req: NextRequest) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();
    const { data: bu } = await sb.from("bank_users").select("bank_id").eq("user_id", userId).limit(1).maybeSingle();
    if (!bu) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    if (!body.mode || !VALID_MODES.includes(body.mode)) {
      return NextResponse.json({ ok: false, error: `Invalid mode. Must be one of: ${VALID_MODES.join(", ")}` }, { status: 400 });
    }

    const { error } = await sb
      .from("relationship_autonomy_profiles")
      .upsert({
        bank_id: bu.bank_id,
        user_id: userId,
        autonomy_mode: body.mode,
        allow_auto_execute: body.mode === "controlled_autonomy",
        require_bundle_approval: body.mode !== "controlled_autonomy",
        updated_at: new Date().toISOString(),
      }, { onConflict: "bank_id,user_id" });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    // Log mode change event (use a generic relationship_id if not provided)
    if (body.relationshipId) {
      await logRelationshipAutonomyEvent({
        relationshipId: body.relationshipId,
        bankId: bu.bank_id,
        eventCode: "autonomy_mode_changed",
        actorType: "banker",
        actorUserId: userId,
        payload: { newMode: body.mode },
      });
    }

    return NextResponse.json({ ok: true, mode: body.mode });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
