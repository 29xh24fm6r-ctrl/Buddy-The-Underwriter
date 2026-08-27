import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";

export type PortalContext = {
  dealId: string;
  bankId: string;
};

/**
 * Canonical portal context resolver for borrower-facing APIs.
 *
 * The selected deal id is accepted only when it exactly matches the
 * HttpOnly borrower session. Every bearer token is otherwise resolved
 * through resolveBorrowerToken, which validates invite revocation/expiry
 * and routes legacy portal links through the authoritative state-machine
 * RPC (expiry, revocation, and single-use consumption).
 */
export async function resolvePortalContext(token: string): Promise<PortalContext> {
  const session = await getBorrowerSession().catch(() => null);
  if (session?.deal_id === token) {
    return { dealId: session.deal_id, bankId: session.bank_id };
  }

  const resolved = await resolveBorrowerToken(token);
  return {
    dealId: resolved.deal_id,
    bankId: resolved.bank_id,
  };
}
