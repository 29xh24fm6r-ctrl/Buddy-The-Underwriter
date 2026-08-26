import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type UserApiContextResult =
  | {
      ok: true;
      sb: SupabaseClient;
      clerkUserId: string;
      actorProfileId: string;
    }
  | {
      ok: false;
      status: 401 | 403 | 500;
      error: "not_authenticated" | "profile_required" | "profile_lookup_failed";
    };

/**
 * Resolve the authenticated Clerk user to Buddy's canonical UUID actor.
 *
 * profiles.id is used by bank_memberships and UUID audit/ownership fields.
 * The service-role client is returned only after the Clerk session and
 * profile mapping have both been verified.
 */
export async function resolveUserApiContext(): Promise<UserApiContextResult> {
  const { userId: clerkUserId } = await clerkAuth();
  if (!clerkUserId) {
    return { ok: false, status: 401, error: "not_authenticated" };
  }

  const sb = supabaseAdmin();
  const profileResult = await sb
    .from("profiles")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (profileResult.error) {
    console.error("[resolveUserApiContext] profile lookup failed", {
      clerkUserId,
      code: profileResult.error.code,
    });
    return { ok: false, status: 500, error: "profile_lookup_failed" };
  }

  if (!profileResult.data?.id) {
    return { ok: false, status: 403, error: "profile_required" };
  }

  return {
    ok: true,
    sb,
    clerkUserId,
    actorProfileId: String(profileResult.data.id),
  };
}
