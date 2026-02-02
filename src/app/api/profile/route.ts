import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureUserProfile } from "@/lib/tenant/ensureUserProfile";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Detect PostgREST schema mismatch errors.
 * Same pattern as buddy/lifecycle/safeFetch.ts.
 */
function isSchemaMismatchError(errorMsg: string): boolean {
  const msg = (errorMsg ?? "").toLowerCase();
  return (
    msg.includes("does not exist") ||
    (msg.includes("column") && msg.includes("not found")) ||
    (msg.includes("pgrst") && msg.includes("400")) ||
    (msg.includes("could not find") && msg.includes("column")) ||
    (msg.includes("relation") && msg.includes("does not exist"))
  );
}

/**
 * Load the user's bank memberships and current bank name.
 * Returns { memberships, current_bank } or empty defaults on error.
 */
async function loadBankContext(userId: string, bankId: string | null) {
  const sb = supabaseAdmin();

  // Fetch memberships (join bank name)
  const { data: memRows } = await sb
    .from("bank_memberships")
    .select("bank_id, role")
    .eq("clerk_user_id", userId);

  type Membership = { bank_id: string; bank_name: string; role: string };
  const memberships: Membership[] = [];

  if (memRows && memRows.length > 0) {
    const bankIds = memRows.map((m: any) => m.bank_id);
    const { data: bankRows } = await sb
      .from("banks")
      .select("id, name")
      .in("id", bankIds);

    const bankMap = new Map<string, string>();
    for (const b of bankRows ?? []) {
      bankMap.set(b.id, b.name);
    }

    for (const m of memRows) {
      memberships.push({
        bank_id: m.bank_id,
        bank_name: bankMap.get(m.bank_id) ?? m.bank_id,
        role: (m as any).role ?? "member",
      });
    }
  }

  // Current bank
  let current_bank: { id: string; name: string } | null = null;
  if (bankId) {
    const existing = memberships.find((m) => m.bank_id === bankId);
    if (existing) {
      current_bank = { id: bankId, name: existing.bank_name };
    } else {
      // bank_id set but not in memberships — fetch directly
      const { data: bk } = await sb
        .from("banks")
        .select("id, name")
        .eq("id", bankId)
        .maybeSingle();
      if (bk) {
        current_bank = { id: bk.id, name: bk.name };
      }
    }
  }

  return { memberships, current_bank };
}

/**
 * GET /api/profile
 *
 * Returns the current user's profile (auto-created if missing),
 * plus bank memberships and current bank context.
 * Schema-safe: returns { ok:false, error:"schema_mismatch" } (200) if
 * avatar columns don't exist yet, instead of a 500.
 */
export async function GET() {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await ensureUserProfile({ userId });
    const bankCtx = await loadBankContext(userId, result.profile.bank_id);

    if (!result.ok) {
      // Schema mismatch — return 200 with degraded profile + error flag
      console.warn(`[GET /api/profile] schema_mismatch: ${result.detail}`);
      return NextResponse.json({
        ok: false,
        error: "schema_mismatch",
        detail: result.detail,
        profile: result.profile,
        ...bankCtx,
      });
    }

    return NextResponse.json({
      ok: true,
      profile: result.profile,
      ...bankCtx,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "profile_load_failed";

    // Final safety net: catch any schema errors that slipped through
    if (isSchemaMismatchError(msg)) {
      console.warn(`[GET /api/profile] schema_mismatch (catch): ${msg}`);
      return NextResponse.json({
        ok: false,
        error: "schema_mismatch",
        detail: msg,
      });
    }

    console.error("[GET /api/profile]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/profile
 *
 * Update display_name and/or avatar_url for the current user.
 * Schema-safe: returns { ok:false, error:"schema_mismatch" } if columns missing.
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

  if (error) {
    const msg = error.message ?? "update_failed";

    if (isSchemaMismatchError(msg)) {
      console.warn(`[PATCH /api/profile] schema_mismatch: ${msg}`);
      return NextResponse.json({
        ok: false,
        error: "schema_mismatch",
        detail: `Cannot update profile: ${msg}. Run migration 20260202_profiles_avatar.sql in prod.`,
      });
    }

    console.error("[PATCH /api/profile]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, error: "profile_not_found" }, { status: 404 });
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
