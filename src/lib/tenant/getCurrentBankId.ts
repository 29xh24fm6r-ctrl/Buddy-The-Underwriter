// src/lib/tenant/getCurrentBankId.ts
import { supabaseServer } from "@/lib/supabase/server";

type BankPick =
  | { ok: true; bankId: string }
  | { ok: false; reason: "not_authenticated" | "no_memberships" | "multiple_memberships" | "profile_lookup_failed"; detail?: string };

async function getUserOrThrow() {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.getUser();
  if (error) throw new Error(`auth_failed: ${error.message}`);
  if (!data?.user) throw new Error("not_authenticated");
  return { sb, userId: data.user.id };
}

/**
 * Option A:
 * - If profiles.bank_id exists -> return it.
 * - Else read memberships:
 *    - 0 -> no_memberships
 *    - 1 -> auto-select (write profiles.bank_id) and return it
 *    - 2+ -> multiple_memberships (user must choose)
 */
export async function getCurrentBankId(): Promise<string> {
  const { sb, userId } = await getUserOrThrow();

  // 1) profiles.bank_id already set?
  const prof = await sb.from("profiles").select("bank_id").eq("id", userId).maybeSingle();
  if (prof.error) throw new Error(`profile_lookup_failed: ${prof.error.message}`);
  if (prof.data?.bank_id) return String(prof.data.bank_id);

  // 2) memberships
  const mem = await sb
    .from("bank_memberships")
    .select("bank_id")
    .eq("user_id", userId);

  if (mem.error) throw new Error(`profile_lookup_failed: ${mem.error.message}`);

  const bankIds = (mem.data ?? []).map((r: any) => String(r.bank_id));
  if (bankIds.length === 0) throw new Error("no_memberships");
  if (bankIds.length > 1) throw new Error("multiple_memberships");

  // 3) auto-select the only bank
  const bankId = bankIds[0];

  const up = await sb
    .from("profiles")
    .update({
      bank_id: bankId,
      last_bank_id: bankId,
      bank_selected_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (up.error) throw new Error(`profile_lookup_failed: ${up.error.message}`);

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
