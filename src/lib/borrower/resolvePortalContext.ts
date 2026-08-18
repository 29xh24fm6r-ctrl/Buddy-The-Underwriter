import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256Base64url } from "@/lib/portal/token";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";

export type PortalContext = {
  dealId: string;
  bankId: string;
};

/**
 * Canonical portal token resolver.
 *
 * Primary path: admin-issued `borrower_invites` token (SHA256 base64url
 * hash lookup) — unchanged, still the only path for the bank/examiner
 * `/portal/[token]` invite flow.
 *
 * Fallback path (SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1): every borrower-
 * facing component mounted inside the self-serve `/start` funnel
 * (IdentityVerificationPanel, PostSubmitHub, ApprovalScoreCard,
 * AssumptionInterview) calls this same `/api/borrower/portal/[token]/*`
 * route family, but passes the borrower's own `dealId` as `token` instead
 * of an invite token — there is no invite in the self-serve funnel. Before
 * this fallback, that always 401'd (0 rows in `borrower_invites` for the
 * brokerage tenant), so every one of those routes was silently unreachable
 * for a real borrower.
 *
 * The fallback accepts `token` as a raw deal ID ONLY when the caller also
 * presents a valid `buddy_borrower_session` cookie whose bound deal_id is
 * an EXACT match for `token`. This can never grant access to a deal other
 * than the one the borrower's own session cookie already authorizes — it
 * is not a general "treat any token as a deal ID" bypass, it just lets the
 * already-authenticated borrower reach their own deal through this route
 * family the same way they already reach it through every other
 * `/api/brokerage/*` route.
 */
export async function resolvePortalContext(token: string): Promise<PortalContext> {
  const sb = supabaseAdmin();

  // `/start` is authenticated by the HttpOnly buddy_borrower_session cookie
  // and intentionally does not expose the raw invite token to the browser.
  // Components shared with `/portal/[token]` therefore receive the selected
  // deal id. Accept that value only when it exactly matches the authenticated
  // session. This keeps one resolver for the shared borrower APIs without
  // weakening token auth or allowing a borrower to probe another deal.
  const session = await getBorrowerSession().catch(() => null);
  if (session?.deal_id === token) {
    return { dealId: session.deal_id, bankId: session.bank_id };
  }

  // Use existing token hash format (base64url, not hex)
  const tokenHash = sha256Base64url(token);

  const { data, error } = await sb
    .from("borrower_invites")
    .select("deal_id, bank_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!error && data) {
    if (data.revoked_at) throw new Error("Invite revoked");
    if (data.expires_at && new Date(data.expires_at) < new Date())
      throw new Error("Invite expired");
    return { dealId: data.deal_id, bankId: data.bank_id };
  }

  // Fallback: self-serve borrower session, scoped to its own deal only.
  const session = await getBorrowerSession();
  if (session?.deal_id && session.deal_id === token) {
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", token)
      .maybeSingle();
    if (!dealErr && deal) {
      return { dealId: deal.id, bankId: deal.bank_id };
    }
  }

  throw new Error("Invalid portal token");
}
