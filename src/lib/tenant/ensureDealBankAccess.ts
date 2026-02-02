import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "./getCurrentBankId";
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
