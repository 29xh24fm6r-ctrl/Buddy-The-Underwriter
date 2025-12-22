// src/lib/tenant/getCurrentBankId.ts
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type BankPick =
  | { ok: true; bankId: string }
  | { ok: false; reason: "not_authenticated" | "no_memberships" | "multiple_memberships" | "profile_lookup_failed"; detail?: string };

/**
 * Get current bank ID using Clerk userId
 * - Uses Clerk for authentication (single source of truth)
 * - Uses Supabase admin client for data lookups (no session required)
 * - Prevents redirect loops by separating auth from tenant resolution
 */
export async function getCurrentBankId(): Promise<string> {
  const { userId } = auth();
  
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
    return String(prof.data.bank_id);
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
    throw new Error("no_memberships");
  }
  
  if (bankIds.length > 1) {
    throw new Error("multiple_memberships");
  }

  // 3) Auto-select the only bank and save to profile
  const bankId = bankIds[0];

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
    if (msg.startsWith("profile_lookup_failed")) return { ok: false, reason: "profile_lookup_failed", detail: msg };
    return { ok: false, reason: "profile_lookup_failed", detail: msg };
  }
}
