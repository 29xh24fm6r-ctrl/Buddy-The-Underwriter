/**
 * P0 SECURITY — Deal authorization helper.
 *
 * Resolves whether a borrower session is authorized to render and interact
 * with a deal. Returns one of four distinct states so the client can render
 * the correct UI for each failure mode.
 *
 * For QA identities, only confirmed_test produces an authorizedDealId.
 * All other states (non-test deal, no deal, lookup failure) produce null.
 */

/**
 * Distinct authorization states:
 * - confirmed_test      — deal exists and is_test=true (QA: authorized)
 * - confirmed_non_test  — deal exists but is_test=false (QA: BLOCKED)
 * - no_selected_deal    — no deal bound to session (must choose)
 * - classification_failure — deal lookup failed (network/DB error)
 */
export type DealAuthorizationState =
  | "confirmed_test"
  | "confirmed_non_test"
  | "no_selected_deal"
  | "classification_failure";

export type AuthorizedDealResult = {
  /** The authorization state — use for UI branching */
  state: DealAuthorizationState;
  /**
   * The deal ID authorized for all deal-scoped requests (seal-status polling,
   * progress hydration, chapter rendering). Null means no deal-scoped
   * requests may be issued.
   */
  authorizedDealId: string | null;
  /** The raw deal ID from the session, if any */
  dealId: string | null;
  /** Whether is_test is confirmed true */
  isTest: boolean;
  /** Borrower name, if resolved */
  name: string | null;
};

export async function resolveAuthorizedDealState(args: {
  dealId: string | null;
  isQA: boolean;
}): Promise<AuthorizedDealResult> {
  if (!args.dealId) {
    return {
      state: "no_selected_deal",
      authorizedDealId: null,
      dealId: null,
      isTest: false,
      name: null,
    };
  }

  // Only QA identities need is_test classification; non-QA always authorized
  if (!args.isQA) {
    return {
      state: "confirmed_test", // non-QA: treat as authorized
      authorizedDealId: args.dealId,
      dealId: args.dealId,
      isTest: false, // non-QA isn't test by definition in this context
      name: null,
    };
  }

  // QA identity — must classify
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();

  try {
    const { data } = await sb
      .from("deals")
      .select("is_test, borrower_name")
      .eq("id", args.dealId)
      .maybeSingle();

    if (!data) {
      return {
        state: "classification_failure",
        authorizedDealId: null,
        dealId: args.dealId,
        isTest: false,
        name: null,
      };
    }

    const deal = data as any;
    const isTest = deal.is_test === true;

    return {
      state: isTest ? "confirmed_test" : "confirmed_non_test",
      authorizedDealId: isTest ? args.dealId : null,
      dealId: args.dealId,
      isTest,
      name: deal.borrower_name?.split(" ")[0] ?? null,
    };
  } catch {
    return {
      state: "classification_failure",
      authorizedDealId: null,
      dealId: args.dealId,
      isTest: false,
      name: null,
    };
  }
}
