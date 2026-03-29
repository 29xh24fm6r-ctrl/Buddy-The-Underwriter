import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

    // Load profile
    const { data: profile } = await sb
      .from("relationship_autonomy_profiles")
      .select("autonomy_mode, allow_auto_execute, require_bundle_approval")
      .eq("bank_id", bu.bank_id)
      .eq("user_id", userId)
      .maybeSingle();

    // Load latest plan
    const { data: latestPlan } = await sb
      .from("relationship_autonomy_plans")
      .select("id, autonomy_mode, status, requires_approval, generated_at")
      .eq("relationship_id", relationshipId)
      .eq("bank_id", bu.bank_id)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Load recent executions
    const { data: recentExecutions } = await sb
      .from("relationship_autonomy_execution_log")
      .select("action_type, execution_mode, status, created_at")
      .eq("relationship_id", relationshipId)
      .eq("bank_id", bu.bank_id)
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      ok: true,
      mode: profile?.autonomy_mode ?? "manual",
      allowAutoExecute: profile?.allow_auto_execute ?? false,
      requireBundleApproval: profile?.require_bundle_approval ?? true,
      latestPlan: latestPlan ?? null,
      recentExecutions: recentExecutions ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
