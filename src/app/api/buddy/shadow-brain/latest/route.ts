import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const requestKey = new URL(req.url).searchParams.get("requestKey");
  if (!requestKey) {
    return NextResponse.json({ ok: false, error: "missing requestKey" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("buddy_shadow_brain_results")
    .select("status, model, latency_ms, result_json, error_text, updated_at")
    .eq("request_key", requestKey)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: true, status: "missing" });

  return NextResponse.json({ ok: true, ...data });
}
