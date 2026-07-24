import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "./getCurrentBankId";
import { getBrokerageBankId } from "./brokerage";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";

type EnsureResult =
  | { ok: true; dealId: string; bankId: string; userId: string }
  | { ok: false; error: "deal_not_found" | "tenant_mismatch" | "unauthorized"; detail?: string };

/**
 * Ensures the current user has access to a deal through their bank membership.
 * Returns the deal's bank_id and userId on success.
 *
 * Logs on all failures for security observability.
 */
export async function ensureDealBankAccess(dealId: string): Promise<EnsureResult> {
  let userId: string | null = null;
  let userBankId: string | null = null;

  try {
    const auth = await clerkAuth();
    userId = auth.userId;

    if (!userId) {
      console.warn("[ensureDealBankAccess] unauthorized: no userId", { dealId });
      return { ok: false, error: "unauthorized", detail: "not_authenticated" };
    }

    userBankId = await getCurrentBankId();

    const sb = supabaseAdmin();
    const { data: deal, error } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (error || !deal) {
      console.warn("[ensureDealBankAccess] deal_not_found", { dealId, userId, userBankId });
      return { ok: false, error: "deal_not_found" };
    }

    if (deal.bank_id !== userBankId) {
      console.warn("[ensureDealBankAccess] TENANT MISMATCH", {
        dealId,
        userId,
        userBankId,
        dealBankId: deal.bank_id,
      });
      return { ok: false, error: "tenant_mismatch", detail: `user bank ${userBankId} != deal bank ${deal.bank_id}` };
    }

    return { ok: true, dealId: deal.id, bankId: deal.bank_id, userId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.warn("[ensureDealBankAccess] error", { dealId, userId, userBankId, error: msg });
    return { ok: false, error: "unauthorized", detail: msg };
  }
}

/**
 * Brokerage-aware variant of ensureDealBankAccess.
 *
 * ensureDealBankAccess compares a deal's bank_id against the caller's single
 * "active bank" (profiles.bank_id, driven by the bank-picker UI) — a
 * per-user, one-bank-at-a-time model. Brokerage staff, however, are
 * authorized via requireBrokerageStaff(): role membership on the singleton
 * Buddy Brokerage tenant specifically, or super_admin — independent of
 * whatever bank their picker happens to be pointed at. Without this, a
 * fully-authorized brokerage staffer gets "tenant_mismatch" on every deal
 * the CRM creates or attributes unless their active-bank picker happens to
 * already be set to the brokerage tenant. Found during live end-to-end QA
 * of SPEC-BROKERAGE-OPERATING-SYSTEM-V1 (PR1-PR5) — every brokerage-sourced
 * deal was unopenable in its own cockpit.
 *
 * Only ever loosens access for deals that actually belong to the brokerage
 * tenant; every other deal falls through to the unchanged strict check.
 * Deliberately scoped to a new function + a single call site (the deal
 * cockpit page) rather than changing ensureDealBankAccess itself, which is
 * relied on by dozens of unrelated underwriting routes this program never
 * touched.
 */
export async function ensureDealBankAccessAllowingBrokerageStaff(dealId: string): Promise<EnsureResult> {
  const strict = await ensureDealBankAccess(dealId);
  if (strict.ok || strict.error !== "tenant_mismatch") return strict;

  try {
    const sb = supabaseAdmin();
    const { data: deal } = await sb.from("deals").select("bank_id").eq("id", dealId).maybeSingle();
    if (!deal?.bank_id) return strict;

    const brokerageBankId = await getBrokerageBankId();
    if (deal.bank_id !== brokerageBankId) return strict;

    const { userId } = await requireBrokerageStaff();
    return { ok: true, dealId, bankId: deal.bank_id, userId };
  } catch {
    return strict;
  }
}
