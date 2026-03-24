import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/profile/bank
 *
 * Switch or set the user's active bank context.
 * Validates membership before updating. Upserts profile with bank_id.
 * This route is part of the canonical bootstrap: bank context must exist
 * before or during profile creation.
 */
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

  // 1. Validate bank exists
  const { data: bank, error: bErr } = await sb
    .from("banks")
    .select("id")
    .eq("id", bankId)
    .maybeSingle();

  if (bErr) {
    console.error("[POST /api/profile/bank] bank lookup failed:", bErr.message);
    return NextResponse.json(
      { ok: false, error: "bank_lookup_failed" },
      { status: 500 },
    );
  }
  if (!bank) {
    return NextResponse.json(
      { ok: false, error: "bank_not_found" },
      { status: 404 },
    );
  }

  // 2. Validate membership — prevents arbitrary tenant switching
  const { data: mem, error: mErr } = await sb
    .from("bank_memberships")
    .select("bank_id")
    .eq("clerk_user_id", userId)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (mErr) {
    console.error("[POST /api/profile/bank] membership lookup failed:", mErr.message);
    return NextResponse.json(
      { ok: false, error: "membership_lookup_failed" },
      { status: 500 },
    );
  }
  if (!mem) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  // 3. Upsert profile with bank_id (conflict on clerk_user_id)
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
    console.error("[POST /api/profile/bank] profile upsert failed:", pErr.message);
    return NextResponse.json(
      { ok: false, error: "profile_update_failed" },
      { status: 500 },
    );
  }

  // 4. Set active bank cookie
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set({
    name: "bank_id",
    value: bankId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
