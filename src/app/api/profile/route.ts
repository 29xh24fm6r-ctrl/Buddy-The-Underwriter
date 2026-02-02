import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureUserProfile } from "@/lib/tenant/ensureUserProfile";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/profile
 *
 * Returns the current user's profile (auto-created if missing).
 */
export async function GET() {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const profile = await ensureUserProfile({ userId });
    return NextResponse.json({ ok: true, profile });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "profile_load_failed";
    console.error("[GET /api/profile]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/profile
 *
 * Update display_name and/or avatar_url for the current user.
 */
export async function PATCH(req: NextRequest) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};

  if ("display_name" in body) {
    const raw = typeof body.display_name === "string" ? body.display_name.trim() : null;
    updates.display_name = raw || null;
  }

  if ("avatar_url" in body) {
    const raw = typeof body.avatar_url === "string" ? body.avatar_url.trim() : null;
    updates.avatar_url = raw || null;
    updates.avatar_updated_at = new Date().toISOString();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: "no_fields_to_update" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("profiles")
    .update(updates as any)
    .eq("clerk_user_id", userId)
    .select("id, clerk_user_id, bank_id, display_name, avatar_url")
    .single();

  if (error || !data) {
    const msg = error?.message ?? "update_failed";
    console.error("[PATCH /api/profile]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    profile: {
      id: data.id,
      clerk_user_id: data.clerk_user_id,
      bank_id: data.bank_id ?? null,
      display_name: (data as any).display_name ?? null,
      avatar_url: (data as any).avatar_url ?? null,
    },
  });
}
