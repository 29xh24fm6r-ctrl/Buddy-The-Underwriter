import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { safeClerkAuth, safeClerkCurrentUser, ClerkTimeoutError } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveOnboardingState } from "@/lib/tenant/onboardingState";

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

// Columns for full and base profile selects
const FULL_SELECT = "id, clerk_user_id, bank_id, display_name, avatar_url";
const BASE_SELECT = "id, clerk_user_id, bank_id";

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

  type BankInfo = { id: string; name: string; logo_url: string | null; website_url: string | null };
  type Membership = { bank_id: string; bank_name: string; role: string };
  const memberships: Membership[] = [];
  const bankInfoMap = new Map<string, BankInfo>();

  if (memRows && memRows.length > 0) {
    const bankIds = memRows.map((m: any) => m.bank_id);
    const { data: bankRows } = await sb
      .from("banks")
      .select("id, name, logo_url, website_url")
      .in("id", bankIds);

    for (const b of bankRows ?? []) {
      bankInfoMap.set(b.id, {
        id: b.id,
        name: b.name,
        logo_url: (b as any).logo_url ?? null,
        website_url: (b as any).website_url ?? null,
      });
    }

    for (const m of memRows) {
      const bank = bankInfoMap.get(m.bank_id);
      memberships.push({
        bank_id: m.bank_id,
        bank_name: bank?.name ?? m.bank_id,
        role: (m as any).role ?? "member",
      });
    }
  }

  // Current bank with full details
  let current_bank: BankInfo | null = null;
  if (bankId) {
    const cached = bankInfoMap.get(bankId);
    if (cached) {
      current_bank = cached;
    } else {
      const { data: bk } = await sb
        .from("banks")
        .select("id, name, logo_url, website_url")
        .eq("id", bankId)
        .maybeSingle();
      if (bk) {
        current_bank = {
          id: bk.id,
          name: bk.name,
          logo_url: (bk as any).logo_url ?? null,
          website_url: (bk as any).website_url ?? null,
        };
      }
    }
  }

  return { memberships, current_bank };
}

/**
 * GET /api/profile
 *
 * READ-ONLY. Returns the current user's profile + bank context.
 * Does NOT auto-create a profile — profile creation is the responsibility
 * of bank selection / bank creation flows.
 *
 * If no profile exists, returns { ok: true, profile: null }.
 */
export async function GET() {
  const startMs = Date.now();
  console.log("[GET /api/profile] enter");

  let userId: string | null = null;
  try {
    const authState = await safeClerkAuth(5000);
    userId = authState?.userId ?? null;
    console.log("[GET /api/profile] auth resolved:", userId ? `${userId.slice(0, 8)}...` : "null", `(${Date.now() - startMs}ms)`);
  } catch (err) {
    if (err instanceof ClerkTimeoutError) {
      console.error("[GET /api/profile] clerk auth TIMEOUT", `(${Date.now() - startMs}ms)`);
      return NextResponse.json({ ok: false, error: "clerk_auth_timeout" }, { status: 503 });
    }
    throw err;
  }

  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  try {
    // Try loading profile with full columns
    console.log("[GET /api/profile] loading profile...");
    const { data: profile, error: loadErr } = await sb
      .from("profiles")
      .select(FULL_SELECT)
      .eq("clerk_user_id", userId)
      .maybeSingle();

    // Schema mismatch on load → retry with base columns
    if (loadErr && isSchemaMismatchError(loadErr.message)) {
      console.warn(`[GET /api/profile] schema_mismatch: ${loadErr.message}`);

      const { data: baseProfile } = await sb
        .from("profiles")
        .select(BASE_SELECT)
        .eq("clerk_user_id", userId)
        .maybeSingle();

      const bankId = baseProfile?.bank_id ?? null;
      const bankCtx = await loadBankContext(userId, bankId);

      return NextResponse.json({
        ok: false,
        error: "schema_mismatch",
        detail: `profiles.display_name or avatar_url missing — run migration 20260202_profiles_avatar.sql`,
        profile: baseProfile
          ? {
              id: baseProfile.id,
              clerk_user_id: baseProfile.clerk_user_id,
              bank_id: bankId,
              display_name: null,
              avatar_url: null,
            }
          : null,
        ...bankCtx,
      });
    }

    if (loadErr) {
      console.error("[GET /api/profile]", loadErr.message);
      return NextResponse.json({ ok: false, error: loadErr.message }, { status: 500 });
    }

    // Profile may not exist — that's fine, return null
    console.log("[GET /api/profile] profile loaded:", profile ? "found" : "null", `(${Date.now() - startMs}ms)`);
    const bankId = profile?.bank_id ?? null;
    console.log("[GET /api/profile] loading bank context, bankId:", bankId);
    const bankCtx = await loadBankContext(userId, bankId);
    console.log("[GET /api/profile] bank context loaded:", bankCtx.current_bank ? bankCtx.current_bank.name : "null", `(${Date.now() - startMs}ms)`);

    // Extract email from Clerk — best-effort, bounded, non-blocking
    let email: string | null = null;
    try {
      const clerkUser = await safeClerkCurrentUser(2000);
      email = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
    } catch (err) {
      console.warn("[GET /api/profile] currentUser degraded:", err instanceof Error ? err.message : "unknown");
    }

    const currentBankRole = bankCtx.current_bank
      ? bankCtx.memberships.find((m) => m.bank_id === bankCtx.current_bank?.id)?.role ?? null
      : null;

    // Derive canonical onboarding state for debuggability
    const onboarding = deriveOnboardingState({
      userId,
      bankId,
      hasProfile: !!profile,
      membershipCount: bankCtx.memberships.length,
    });

    console.log("[GET /api/profile] done", `(${Date.now() - startMs}ms total)`);
    return NextResponse.json({
      ok: true,
      profile: profile
        ? {
            id: profile.id,
            clerk_user_id: profile.clerk_user_id,
            bank_id: profile.bank_id ?? null,
            display_name: (profile as any).display_name ?? null,
            avatar_url: (profile as any).avatar_url ?? null,
          }
        : null,
      email,
      current_bank_role: currentBankRole,
      onboarding_state: onboarding.state,
      ...bankCtx,
    });
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
 * Schema-safe: returns { ok:false, error:"schema_mismatch" } if columns missing.
 */
export async function PATCH(req: NextRequest) {
  const { userId } = await safeClerkAuth(5000);
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
