import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "./getCurrentBankId";
import { getBrokerageBankId } from "./brokerage";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Proof that an authenticated access check actually ran for a (deal, bank).
 *
 * Audit F-15: the canonical memo builder used to accept the plain string
 * `executionContext: "authorized_route"` to skip its own tenant check, on the
 * documented promise that the caller had authenticated first. That promise
 * was enforced only by source-regex guards naming two specific files, so a
 * third caller could claim authorization it never performed.
 *
 * The brand symbol is module-private: a grant cannot be constructed outside
 * this file, and it carries the (dealId, bankId) it was issued for so it
 * cannot be replayed against a different deal.
 */
const ACCESS_GRANT_BRAND = Symbol("dealBankAccessGrant");

export type DealBankAccessGrant = {
  readonly [ACCESS_GRANT_BRAND]: true;
  readonly dealId: string;
  readonly bankId: string;
};

function issueGrant(dealId: string, bankId: string): DealBankAccessGrant {
  return { [ACCESS_GRANT_BRAND]: true, dealId, bankId };
}

/**
 * Verify a grant was issued by this module for exactly this (deal, bank).
 * Anything else — a hand-built object, a grant for another deal — is refused.
 */
export function isDealBankAccessGrantFor(
  grant: DealBankAccessGrant | undefined,
  dealId: string,
  bankId: string,
): boolean {
  return (
    !!grant &&
    grant[ACCESS_GRANT_BRAND] === true &&
    grant.dealId === dealId &&
    grant.bankId === bankId
  );
}

type EnsureResult =
  | { ok: true; dealId: string; bankId: string; userId: string; grant: DealBankAccessGrant }
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

    return { ok: true, dealId: deal.id, bankId: deal.bank_id, userId, grant: issueGrant(deal.id, deal.bank_id) };
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
  // Resolve a brokerage deal before invoking the strict active-bank probe.
  // Authorized brokerage staff commonly keep a commercial-bank picker active;
  // probing strict access first emits a false TENANT MISMATCH security alarm
  // even though the scoped brokerage fallback immediately grants access.
  try {
    const sb = supabaseAdmin();
    const { data: deal } = await sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle();
    if (deal?.bank_id) {
      const brokerageBankId = await getBrokerageBankId();
      if (deal.bank_id === brokerageBankId) {
        const { userId } = await requireBrokerageStaff();
        return { ok: true, dealId: deal.id, bankId: deal.bank_id, userId, grant: issueGrant(deal.id, deal.bank_id) };
      }
    }
  } catch {
    // Preserve the canonical strict result for missing, non-brokerage, or
    // unauthorized callers without exposing why the brokerage probe failed.
  }

  return ensureDealBankAccess(dealId);
}
