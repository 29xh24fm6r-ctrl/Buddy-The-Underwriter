// src/app/api/tenant/select/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return NextResponse.json({ ok: false, error: authErr.message }, { status: 401 });
  if (!auth?.user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const form = await req.formData();
  const bankId = String(form.get("bank_id") || "").trim();
  if (!bankId) return NextResponse.json({ ok: false, error: "missing_bank_id" }, { status: 400 });

  // ensure user is a member
  const mem = await sb
    .from("bank_memberships")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (mem.error) return NextResponse.json({ ok: false, error: mem.error.message }, { status: 500 });
  if (!mem.data) return NextResponse.json({ ok: false, error: "not_a_member" }, { status: 403 });

  const up = await sb
    .from("profiles")
    .update({
      bank_id: bankId,
      last_bank_id: bankId,
      bank_selected_at: new Date().toISOString(),
    })
    .eq("id", auth.user.id);

  if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 });

  // redirect to deals
  return NextResponse.redirect(new URL("/deals", req.url), { status: 303 });
}
