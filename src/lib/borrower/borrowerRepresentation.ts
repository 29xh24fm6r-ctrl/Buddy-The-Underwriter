/**
 * SPEC-UNDERWRITE-GUARD-BORROWER-REPRESENTATION-PARITY-1
 *
 * Single source of truth for "does this deal have a borrower attached?" — used
 * by BOTH the lifecycle derivation (JourneyRail) and the underwrite verifier so
 * they can never disagree again.
 *
 * The "Attach Borrower" page writes deal_borrower_story / deal_management_profiles,
 * NOT the legacy deals.borrower_id FK. A deal is considered to have a borrower
 * represented when ANY of those exist. Only when none do is the borrower
 * genuinely missing (the real "attach a borrower" entry point).
 *
 * This module is intentionally pure (no "server-only"): the async accessor takes
 * the Supabase client as a parameter, so the decision logic is unit-testable.
 */

export type BorrowerRepresentationInput = {
  borrowerId?: string | null;
  managementProfileCount: number;
  borrowerStoryCount: number;
};

/** Pure decision: borrower is represented by the FK OR a story OR a management profile. */
export function borrowerIsRepresented(input: BorrowerRepresentationInput): boolean {
  return (
    !!input.borrowerId ||
    input.managementProfileCount > 0 ||
    input.borrowerStoryCount > 0
  );
}

type MinimalSb = {
  from: (table: string) => any;
};

/**
 * Async accessor shared by deriveLifecycleState and verifyUnderwriteCore.
 * Short-circuits on a present borrower_id; otherwise counts the borrower-profile
 * flow's artifacts. On query failure, returns false (treat as missing) — the
 * same safe default both call sites had before consolidation.
 */
export async function hasBorrowerRepresentation(
  sb: MinimalSb,
  dealId: string,
  borrowerId?: string | null,
): Promise<boolean> {
  if (borrowerId) return true;
  try {
    const [mgmtRes, storyRes] = await Promise.all([
      sb
        .from("deal_management_profiles")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId),
      sb
        .from("deal_borrower_story")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId),
    ]);
    return borrowerIsRepresented({
      borrowerId,
      managementProfileCount: (mgmtRes as any)?.count ?? 0,
      borrowerStoryCount: (storyRes as any)?.count ?? 0,
    });
  } catch {
    return false;
  }
}
