import { NextResponse } from "next/server";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { userId } = await clerkAuth();

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}) as any);
  const bankId = String(body?.bank_id || "").trim();

  if (!bankId) {
    return NextResponse.json(
      { ok: false, error: "missing_bank_id" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // Validate bank exists
  const { data: bank, error: bErr } = await sb
    .from("banks")
    .select("id")
    .eq("id", bankId)
    .maybeSingle();

  if (bErr)
    return NextResponse.json(
      { ok: false, error: bErr.message },
      { status: 500 },
    );
  if (!bank)
    return NextResponse.json(
      { ok: false, error: "bank_not_found" },
      { status: 404 },
    );

  // Upsert profile using Clerk user ID
  const { error: pErr } = await sb.from("profiles").upsert(
    {
      clerk_user_id: userId,
      bank_id: bankId,
      last_bank_id: bankId,
      bank_selected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clerk_user_id" },
  );

  if (pErr) {
    return NextResponse.json(
      { ok: false, error: pErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
