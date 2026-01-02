// src/lib/tenant/getCurrentBankId.ts
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
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
    // ✅ DEV SAFETY: if user is signed in but has no bank membership yet,
    // auto-provision a bank + membership so the app can function.
    // This prevents "missing bank context" 400s during early development.
    
    console.log(`[getCurrentBankId] No bank memberships found for user ${userId}, auto-provisioning...`);
    
    // 1) Check if a default dev bank exists (code: "OGB")
    const { data: existingBank } = await sb
      .from("banks")
      .select("id, code")
      .eq("code", "OGB")
      .maybeSingle();
    
    let bankId: string;
    
    if (existingBank) {
      bankId = existingBank.id;
      console.log(`[getCurrentBankId] Using existing default bank: ${bankId}`);
    } else {
      // 2) Create a new default bank
      const { data: newBank, error: bankErr } = await sb
        .from("banks")
        .insert({
          code: "OGB",
          name: "Octagon Bank (Default)",
        })
        .select("id")
        .single();
      
      if (bankErr) {
        throw new Error(`Failed to create default bank: ${bankErr.message}`);
      }
      
      bankId = newBank!.id;
      console.log(`[getCurrentBankId] Created new default bank: ${bankId}`);
    }
    
    // 3) Create membership for the current user
    const { error: memErr } = await sb
      .from("bank_memberships")
      .insert({
        bank_id: bankId,
        clerk_user_id: userId,
        role: "admin",
      });
    
    if (memErr) {
      throw new Error(`Failed to create bank membership: ${memErr.message}`);
    }
    
    console.log(`[getCurrentBankId] Created bank membership for user ${userId}`);
    
    // 4) Update profile with bank_id
    await sb
      .from("profiles")
      .update({
        bank_id: bankId,
        last_bank_id: bankId,
        bank_selected_at: new Date().toISOString(),
      })
      .eq("clerk_user_id", userId);
    
    return bankId;
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
