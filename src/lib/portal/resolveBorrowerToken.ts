import "server-only";

import { requireValidInvite } from "@/lib/portal/auth";
import {
  peekBorrowerPortalLink,
  consumeBorrowerPortalLink,
  PortalLinkError,
} from "@/lib/portal/portalLinkState";

/**
 * Unified borrower-token resolution.
 *
 * A borrower token can live in EITHER of two tables:
 *   - `borrower_invites`      — hashed tokens written by the deal-workspace
 *                               "Invite borrower" action (`/api/deals/[dealId]/portal/invite`).
 *   - `borrower_portal_links` — plaintext tokens written by create-link /
 *                               send-link (the Twilio SMS path).
 *
 * Before this helper the borrower surfaces were split across the two tables with
 * no bridge: the `/upload/[token]` page consumed `borrower_portal_links` while
 * the upload `prepare`/`commit` routes validated `borrower_invites` (and the
 * portal context/status routes were split the other way). The result was that
 * NO single token resolved across the whole path, so an invited borrower always
 * hit "Invalid link" and could never upload a document.
 *
 * This resolver accepts a token from either table so every borrower route agrees.
 * It tries `borrower_invites` first (a direct table read with no RPC dependency),
 * then falls back to the portal-link state machine.
 */
export type ResolvedBorrowerToken = {
  deal_id: string;
  bank_id: string;
  name: string | null;
  email: string | null;
  source: "invite" | "portal_link";
};

async function tryInvite(token: string): Promise<ResolvedBorrowerToken | null> {
  try {
    const invite = await requireValidInvite(token);
    return {
      deal_id: invite.deal_id,
      bank_id: invite.bank_id,
      name: invite.name ?? null,
      email: invite.email ?? null,
      source: "invite",
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a borrower token WITHOUT consuming it (safe to call on every request,
 * e.g. page load, prepare, and commit). Throws `PortalLinkError("link_not_found")`
 * when the token is absent from both tables.
 */
export async function resolveBorrowerToken(
  token: string,
): Promise<ResolvedBorrowerToken> {
  const invite = await tryInvite(token);
  if (invite) return invite;

  // Fall back to the portal-link state machine (peek — never marks used).
  const link = await peekBorrowerPortalLink(token);
  return {
    deal_id: link.deal_id,
    bank_id: link.bank_id,
    name: null,
    email: null,
    source: "portal_link",
  };
}

/**
 * Resolve a borrower token, consuming single-use portal links (marks `used_at`).
 * Invite tokens are validated but not mutated. Use this only where a single-use
 * consumption is intended; upload flows should prefer {@link resolveBorrowerToken}
 * (peek) so the link survives prepare → commit.
 */
export async function resolveAndConsumeBorrowerToken(
  token: string,
): Promise<ResolvedBorrowerToken> {
  const invite = await tryInvite(token);
  if (invite) return invite;

  const link = await consumeBorrowerPortalLink(token);
  return {
    deal_id: link.deal_id,
    bank_id: link.bank_id,
    name: null,
    email: null,
    source: "portal_link",
  };
}

export { PortalLinkError };
