// src/app/api/tenant/select/route.ts
//
// Legacy bank-selection route (Supabase auth path).
// Validates membership before updating profile.bank_id.
// Does NOT create profiles — only updates existing ones.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr)
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  if (!auth?.user)
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );

  const form = await req.formData();
  const bankId = String(form.get("bank_id") || "").trim();
  if (!bankId)
    return NextResponse.json(
      { ok: false, error: "missing_bank_id" },
      { status: 400 },
    );

  // Ensure user is a member of the target bank
  const mem = await sb
    .from("bank_memberships")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (mem.error) {
    console.error("[POST /api/tenant/select] membership lookup failed:", mem.error.message);
    return NextResponse.json(
      { ok: false, error: "membership_lookup_failed" },
      { status: 500 },
    );
  }
  if (!mem.data)
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );

  // Update profile bank context (uses Supabase auth user.id as profiles.id)
  const up = await sb
    .from("profiles")
    .update({
      bank_id: bankId,
      last_bank_id: bankId,
      bank_selected_at: new Date().toISOString(),
    })
    .eq("id", auth.user.id);

  if (up.error) {
    console.error("[POST /api/tenant/select] profile update failed:", up.error.message);
    return NextResponse.json(
      { ok: false, error: "profile_update_failed" },
      { status: 500 },
    );
  }

  // Redirect to deals
  return NextResponse.redirect(new URL("/deals", req.url), { status: 303 });
}
