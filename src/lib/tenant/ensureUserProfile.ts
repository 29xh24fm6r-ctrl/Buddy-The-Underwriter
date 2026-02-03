import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type UserProfile = {
  id: string;
  clerk_user_id: string;
  bank_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export type EnsureProfileResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; error: "schema_mismatch"; detail: string; profile: UserProfile };

/**
 * Detect PostgREST schema mismatch errors (missing column, relation, etc.).
 * Same pattern used in buddy/lifecycle/safeFetch.ts.
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

// Columns that require the avatar migration
const FULL_SELECT = "id, clerk_user_id, bank_id, display_name, avatar_url";
// Safe fallback: only base columns guaranteed to exist
const BASE_SELECT = "id, clerk_user_id, bank_id";

/**
 * Idempotent profile provisioning.
 *
 * If a profiles row exists for the given Clerk user, return it.
 * If missing, insert one with sensible defaults.
 *
 * Schema-safe: if avatar columns don't exist yet (prod migration pending),
 * falls back to base columns and returns { ok:false, error:"schema_mismatch" }.
 *
 * Never throws for "missing profile" — only throws on non-schema DB errors.
 */
export async function ensureUserProfile(opts: {
  userId: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}): Promise<EnsureProfileResult> {
  const sb = supabaseAdmin();

  // 1) Try full select (with avatar columns)
  const { data: existing, error: loadErr } = await sb
    .from("profiles")
    .select(FULL_SELECT)
    .eq("clerk_user_id", opts.userId)
    .maybeSingle();

  // Schema mismatch on load → retry with base columns only
  if (loadErr && isSchemaMismatchError(loadErr.message)) {
    const detail = `profiles.display_name or avatar_url missing — run migration 20260202_profiles_avatar.sql`;
    console.warn(
      `[api.profile] SCHEMA MISMATCH on load: ${loadErr.message}. Falling back to base columns.`,
    );

    const { data: base, error: baseErr } = await sb
      .from("profiles")
      .select(BASE_SELECT)
      .eq("clerk_user_id", opts.userId)
      .maybeSingle();

    if (baseErr) {
      throw new Error(`ensureUserProfile: base load failed: ${baseErr.message}`);
    }

    if (base) {
      return {
        ok: false,
        error: "schema_mismatch",
        detail,
        profile: {
          id: base.id,
          clerk_user_id: base.clerk_user_id,
          bank_id: base.bank_id ?? null,
          display_name: null,
          avatar_url: null,
        },
      };
    }

    // Profile doesn't exist — try to insert with base columns only
    const { data: baseInserted, error: baseInsertErr } = await sb
      .from("profiles")
      .upsert(
        {
          clerk_user_id: opts.userId,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "clerk_user_id" },
      )
      .select(BASE_SELECT)
      .single();

    if (baseInsertErr) {
      throw new Error(`ensureUserProfile: base insert failed: ${baseInsertErr.message}`);
    }

    return {
      ok: false,
      error: "schema_mismatch",
      detail,
      profile: {
        id: baseInserted.id,
        clerk_user_id: baseInserted.clerk_user_id,
        bank_id: baseInserted.bank_id ?? null,
        display_name: null,
        avatar_url: null,
      },
    };
  }

  if (loadErr) {
    throw new Error(`ensureUserProfile: load failed: ${loadErr.message}`);
  }

  if (existing) {
    const existingAvatarUrl = (existing as any).avatar_url ?? null;

    // Backfill avatar_url if empty and opts.avatarUrl is provided
    // Do NOT overwrite a non-empty avatar_url (user may have set a custom one)
    if (!existingAvatarUrl && opts.avatarUrl) {
      const { error: updateErr } = await sb
        .from("profiles")
        .update({
          avatar_url: opts.avatarUrl,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("clerk_user_id", opts.userId);

      if (updateErr) {
        // Log but don't fail — avatar backfill is best-effort
        console.warn(`[ensureUserProfile] avatar backfill failed: ${updateErr.message}`);
      } else {
        return {
          ok: true,
          profile: {
            id: existing.id,
            clerk_user_id: existing.clerk_user_id,
            bank_id: existing.bank_id ?? null,
            display_name: (existing as any).display_name ?? null,
            avatar_url: opts.avatarUrl,
          },
        };
      }
    }

    return {
      ok: true,
      profile: {
        id: existing.id,
        clerk_user_id: existing.clerk_user_id,
        bank_id: existing.bank_id ?? null,
        display_name: (existing as any).display_name ?? null,
        avatar_url: existingAvatarUrl,
      },
    };
  }

  // 2) Profile missing — create one (full columns)
  const defaultDisplayName =
    opts.name?.trim() ||
    opts.email?.split("@")[0] ||
    null;

  const { data: inserted, error: insertErr } = await sb
    .from("profiles")
    .upsert(
      {
        clerk_user_id: opts.userId,
        display_name: defaultDisplayName,
        avatar_url: opts.avatarUrl ?? null,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "clerk_user_id" },
    )
    .select(FULL_SELECT)
    .single();

  // Schema mismatch on insert → fall back
  if (insertErr && isSchemaMismatchError(insertErr.message)) {
    const detail = `profiles.display_name or avatar_url missing — run migration 20260202_profiles_avatar.sql`;
    console.warn(
      `[api.profile] SCHEMA MISMATCH on insert: ${insertErr.message}. Falling back to base columns.`,
    );

    const { data: baseInserted, error: baseInsertErr } = await sb
      .from("profiles")
      .upsert(
        {
          clerk_user_id: opts.userId,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "clerk_user_id" },
      )
      .select(BASE_SELECT)
      .single();

    if (baseInsertErr) {
      throw new Error(`ensureUserProfile: base insert failed: ${baseInsertErr.message}`);
    }

    return {
      ok: false,
      error: "schema_mismatch",
      detail,
      profile: {
        id: baseInserted.id,
        clerk_user_id: baseInserted.clerk_user_id,
        bank_id: baseInserted.bank_id ?? null,
        display_name: null,
        avatar_url: null,
      },
    };
  }

  if (insertErr) {
    throw new Error(`ensureUserProfile: insert failed: ${insertErr.message}`);
  }

  return {
    ok: true,
    profile: {
      id: inserted.id,
      clerk_user_id: inserted.clerk_user_id,
      bank_id: inserted.bank_id ?? null,
      display_name: (inserted as any).display_name ?? null,
      avatar_url: (inserted as any).avatar_url ?? null,
    },
  };
}
