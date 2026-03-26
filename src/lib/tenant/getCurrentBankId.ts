// src/lib/tenant/getCurrentBankId.ts
import "server-only";

import { clerkAuth, isClerkConfigured, clerkCurrentUser } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureSandboxGate, ensureSandboxMembership } from "@/lib/tenant/sandbox";
import { ensureUserProfile } from "@/lib/tenant/ensureUserProfile";

type BankPick =
  | { ok: true; bankId: string }
  | { ok: false; reason: "not_authenticated" | "no_memberships" | "multiple_memberships" | "bank_selection_required" | "profile_lookup_failed" | "sandbox_forbidden"; detail?: string };

/**
 * Helper: upsert profile with a known bankId.
 * Best-effort — logs but never blocks bank resolution.
 */
async function ensureProfileWithBank(userId: string, bankId: string): Promise<void> {
  try {
    const user = await clerkCurrentUser();
    const email = user?.emailAddresses?.find(
      (e: any) => e.id === user.primaryEmailAddressId,
    )?.emailAddress ?? null;
    const name = user?.firstName
      ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
      : null;
    await ensureUserProfile({ userId, bankId, email, name });
  } catch (e) {
    console.warn("[getCurrentBankId] ensureUserProfile failed:", e);
  }
}

/**
 * Get current bank ID using Clerk userId
 * - Uses Clerk for authentication (single source of truth)
 * - Uses Supabase admin client for data lookups (no session required)
 * - Prevents redirect loops by separating auth from tenant resolution
 *
 * INVARIANT: Profile is only created/upserted after bank context is resolved.
 * Profile MUST exist before membership insert because the DB trigger
 * `trg_bank_memberships_fill_user_id` resolves `user_id` from
 * `profiles.id` via `clerk_user_id`.
 */
export async function getCurrentBankId(): Promise<string> {
  if (!isClerkConfigured()) {
    throw new Error("Auth not configured (Clerk keys missing/placeholder).");
  }
  const { userId } = await clerkAuth();

  if (!userId) {
    throw new Error("not_authenticated");
  }

  const sb = supabaseAdmin();

  // 1) Check if user has a bank_id set in profiles
  const prof = await sb
    .from("profiles")
    .select("bank_id")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (prof.error) {
    throw new Error(`profile_lookup_failed: ${prof.error.message}`);
  }

  if (prof.data?.bank_id) {
    const bankId = String(prof.data.bank_id);
    await ensureSandboxGate(bankId, userId);
    return bankId;
  }

  // 2) Check bank_memberships for this Clerk user
  const mem = await sb
    .from("bank_memberships")
    .select("bank_id")
    .eq("clerk_user_id", userId);

  if (mem.error) {
    throw new Error(`profile_lookup_failed: ${mem.error.message}`);
  }

  const bankIds = (mem.data ?? []).map((r: any) => String(r.bank_id));

  if (bankIds.length === 0) {
    // Sandbox path — ensureSandboxMembership handles profile+membership internally
    const sandbox = await ensureSandboxMembership(userId);
    if (sandbox.ok && sandbox.bankId) {
      await ensureSandboxGate(sandbox.bankId, userId);
      return sandbox.bankId;
    }

    // DEV SAFETY (guarded): auto-provision for development only
    const allowAutoProvision = process.env.BUDDY_DEV_AUTO_PROVISION === "1";

    if (!allowAutoProvision) {
      throw new Error("no_memberships");
    }

    console.log(`[getCurrentBankId] No bank memberships found for user ${userId}, auto-provisioning...`);

    // 1) Check if a default dev bank exists (code: "DEV_DEFAULT")
    //    Legacy: previously used code "OGB" (Old Glory Bank). Now tenant-neutral.
    const DEV_BANK_CODE = "DEV_DEFAULT";
    const { data: existingBank } = await sb
      .from("banks")
      .select("id, code")
      .or(`code.eq.${DEV_BANK_CODE},code.eq.OGB`)
      .maybeSingle();

    let bankId: string;

    if (existingBank) {
      bankId = existingBank.id;
      console.log(`[getCurrentBankId] Using existing default bank: ${bankId}`);
    } else {
      const { data: newBank, error: bankErr } = await sb
        .from("banks")
        .insert({
          code: DEV_BANK_CODE,
          name: "Dev Bank (Auto-Provisioned)",
        })
        .select("id")
        .single();

      if (bankErr) {
        throw new Error(`Failed to create default bank: ${bankErr.message}`);
      }

      bankId = newBank!.id;
      console.log(`[getCurrentBankId] Created new default bank: ${bankId}`);
    }

    // 2) Profile FIRST (trigger needs it to resolve user_id)
    await ensureProfileWithBank(userId, bankId);

    // 3) Membership SECOND (trigger resolves user_id from profile)
    const { error: memInsertErr } = await sb
      .from("bank_memberships")
      .insert({
        bank_id: bankId,
        clerk_user_id: userId,
        role: "admin",
      });

    if (memInsertErr) {
      throw new Error(`Failed to create bank membership: ${memInsertErr.message}`);
    }

    console.log(`[getCurrentBankId] Created bank membership for user ${userId}`);

    // 4) Set active bank on profile
    await sb
      .from("profiles")
      .update({
        bank_id: bankId,
        last_bank_id: bankId,
        bank_selected_at: new Date().toISOString(),
      })
      .eq("clerk_user_id", userId);

    await ensureSandboxGate(bankId, userId);
    return bankId;
  }

  if (bankIds.length > 1) {
    throw new Error("bank_selection_required");
  }

  // 3) Single membership — auto-select and ensure profile with bank_id
  const bankId = bankIds[0];

  await ensureSandboxGate(bankId, userId);

  // Ensure profile exists (for completeness — may already exist)
  await ensureProfileWithBank(userId, bankId);

  // Set active bank context
  const up = await sb
    .from("profiles")
    .update({
      bank_id: bankId,
      last_bank_id: bankId,
      bank_selected_at: new Date().toISOString(),
    })
    .eq("clerk_user_id", userId);

  if (up.error) {
    throw new Error(`profile_lookup_failed: ${up.error.message}`);
  }

  return bankId;
}

/** Convenience helper for UI gates */
export async function tryGetCurrentBankId(): Promise<BankPick> {
  try {
    const bankId = await getCurrentBankId();
    return { ok: true, bankId };
  } catch (e: any) {
    const msg = String(e?.message || "profile_lookup_failed");
    if (msg === "not_authenticated") return { ok: false, reason: "not_authenticated" };
    if (msg === "no_memberships") return { ok: false, reason: "no_memberships" };
    if (msg === "multiple_memberships") return { ok: false, reason: "multiple_memberships" };
    if (msg === "bank_selection_required") return { ok: false, reason: "bank_selection_required" };
    if (msg === "sandbox_forbidden") return { ok: false, reason: "sandbox_forbidden" };
    if (msg.startsWith("profile_lookup_failed")) return { ok: false, reason: "profile_lookup_failed", detail: msg };
    return { ok: false, reason: "profile_lookup_failed", detail: msg };
  }
}
