import "server-only";
import { headers, cookies } from "next/headers";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type BankEmailRouting = {
  contact_to_email: string;
  outbound_from_email: string;
  reply_to_mode: "submitter" | "configured";
  configured_reply_to_email: string | null;
  is_enabled: boolean;
};

function isAllowedFrom(from: string): boolean {
  const raw = process.env.ALLOWED_OUTBOUND_FROM_EMAILS;
  if (!raw) return true; // dev permissive
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(from);
}

/**
 * Bank resolution strategy (best effort):
 *  1) Explicit header x-bank-id (dev / internal tooling)
 *  2) Portal token (x-portal-token) -> resolvePortalContext -> bankId
 *  3) Cookie "bank_id" (tenant select form often sets one)
 */
export async function resolveBankIdFromRequest(): Promise<string | null> {
  const h = await headers();

  // 1) Explicit header for dev/internal tooling
  const explicit = h.get("x-bank-id");
  if (explicit) return explicit;

  // 2) Portal token (if present) -> resolve bank_id
  const portalToken = h.get("x-portal-token");
  if (portalToken) {
    try {
      const ctx = await resolvePortalContext(portalToken);
      if (ctx?.bankId) return ctx.bankId;
    } catch {
      // ignore - fallthrough to other methods
    }
  }

  // 3) Cookie-based tenant selection
  const c = await cookies();
  const cookieBank = c.get("bank_id")?.value;
  if (cookieBank) return cookieBank;

  return null;
}

export async function loadBankEmailRouting(): Promise<{
  bankId: string | null;
  routing: BankEmailRouting | null;
}> {
  const bankId = await resolveBankIdFromRequest();
  if (!bankId) return { bankId: null, routing: null };

  const sb = getSupabaseServerClient();

  const { data, error } = await sb
    .from("bank_email_routing")
    .select("contact_to_email,outbound_from_email,reply_to_mode,configured_reply_to_email,is_enabled")
    .eq("bank_id", bankId)
    .maybeSingle();

  if (error || !data || !data.is_enabled) return { bankId, routing: null };

  const routing = data as BankEmailRouting;

  // Safety: reject if FROM not in allowlist
  if (!isAllowedFrom(routing.outbound_from_email)) return { bankId, routing: null };

  return { bankId, routing };
}
