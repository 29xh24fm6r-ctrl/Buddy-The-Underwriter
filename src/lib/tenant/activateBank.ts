// src/lib/tenant/activateBank.ts
import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureUserProfile } from "@/lib/tenant/ensureUserProfile";

/**
 * Activate bank context for a user.
 *
 * Canonical order: profile (with bank_id) → membership → active context.
 * The bank row must already exist before calling this.
 *
 * Profile is created/upserted BEFORE membership because the
 * `trg_bank_memberships_fill_user_id` trigger resolves
 * `bank_memberships.user_id` from `profiles.id` via `clerk_user_id`.
 */
export async function activateBank(
  userId: string,
  bankId: string,
  bank: { id: string; name: string; logo_url?: string | null; website_url?: string | null },
  opts?: {
    existing?: boolean;
    claimed?: boolean;
    skipMembership?: boolean;
    role?: string;
    callerTag?: string;
  },
): Promise<NextResponse> {
  const sb = supabaseAdmin();
  const tag = opts?.callerTag ?? "[activateBank]";

  // Step 1: Ensure profile exists with this bank_id
  const profileResult = await ensureUserProfile({ userId, bankId });
  if (!profileResult.ok && profileResult.error !== "schema_mismatch") {
    console.error(`${tag} ensureUserProfile failed:`, profileResult);
    return NextResponse.json(
      {
        ok: false,
        error: "profile_setup_failed",
        detail: "Could not set up your user profile. Please try again.",
      },
      { status: 500 },
    );
  }

  // Step 2: Create membership (if not already done by caller)
  if (!opts?.skipMembership) {
    const { error: memErr } = await sb
      .from("bank_memberships")
      .upsert(
        {
          bank_id: bankId,
          clerk_user_id: userId,
          role: opts?.role ?? "admin",
        },
        { onConflict: "bank_id,clerk_user_id" },
      );

    if (memErr) {
      const isDuplicate = memErr.code === "23505" || memErr.message?.includes("duplicate");
      if (!isDuplicate) {
        console.error(`${tag} membership insert failed:`, memErr.message);
      }
    }
  }

  // Step 3: Set active bank context on profile
  await sb
    .from("profiles")
    .update({
      bank_id: bankId,
      last_bank_id: bankId,
      bank_selected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("clerk_user_id", userId);

  const res = NextResponse.json(
    {
      ok: true,
      bank: { id: bank.id, name: bank.name },
      current_bank: {
        id: bank.id,
        name: bank.name,
        logo_url: bank.logo_url ?? null,
        website_url: bank.website_url ?? null,
      },
      ...(opts?.existing ? { existing: true } : {}),
      ...(opts?.claimed ? { claimed: true } : {}),
    },
    { status: opts?.existing || opts?.claimed ? 200 : 201 },
  );
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
