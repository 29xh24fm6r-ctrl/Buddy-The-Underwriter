import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type UserProfile = {
  id: string;
  clerk_user_id: string;
  bank_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * Idempotent profile provisioning.
 *
 * If a profiles row exists for the given Clerk user, return it.
 * If missing, insert one with sensible defaults.
 *
 * Never throws for "missing profile" — only throws on DB errors.
 */
export async function ensureUserProfile(opts: {
  userId: string;
  email?: string | null;
  name?: string | null;
}): Promise<UserProfile> {
  const sb = supabaseAdmin();

  // 1) Try to load existing profile
  const { data: existing, error: loadErr } = await sb
    .from("profiles")
    .select("id, clerk_user_id, bank_id, display_name, avatar_url")
    .eq("clerk_user_id", opts.userId)
    .maybeSingle();

  if (loadErr) {
    throw new Error(`ensureUserProfile: load failed: ${loadErr.message}`);
  }

  if (existing) {
    return {
      id: existing.id,
      clerk_user_id: existing.clerk_user_id,
      bank_id: existing.bank_id ?? null,
      display_name: (existing as any).display_name ?? null,
      avatar_url: (existing as any).avatar_url ?? null,
    };
  }

  // 2) Profile missing — create one
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
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "clerk_user_id" },
    )
    .select("id, clerk_user_id, bank_id, display_name, avatar_url")
    .single();

  if (insertErr) {
    throw new Error(`ensureUserProfile: insert failed: ${insertErr.message}`);
  }

  return {
    id: inserted.id,
    clerk_user_id: inserted.clerk_user_id,
    bank_id: inserted.bank_id ?? null,
    display_name: (inserted as any).display_name ?? null,
    avatar_url: (inserted as any).avatar_url ?? null,
  };
}
