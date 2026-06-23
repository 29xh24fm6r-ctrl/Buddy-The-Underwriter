/**
 * SPEC-BORROWER-ENTITY-SPONSOR-SEPARATION-1
 *
 * Single source of truth for the THREE distinct borrower-related credit concepts
 * that the product previously conflated:
 *
 *   1. Legal borrower IDENTITY  — who the legal borrowing entity is.
 *   2. Borrower NARRATIVE       — the business story (description / revenue model).
 *   3. Management / sponsor /   — principals, officers, sponsors, guarantors who
 *      guarantor PROFILE          *support* the borrower (deal_management_profiles).
 *
 * These are different credit concepts and must be gated independently:
 *   - "Attach borrower" / borrower_not_attached  ⇒ legal identity genuinely absent.
 *   - missing_business_description / missing_revenue_model ⇒ narrative gaps.
 *   - missing_management_profile (+ guarantor/sponsor) ⇒ supporting-profile gaps.
 *
 * CRITICAL CONTRACT: a management / sponsor / guarantor profile does NOT satisfy
 * legal borrower identity. The /borrower page writes deal_management_profiles —
 * it documents the people behind the deal, it does NOT attach the legal borrower
 * entity. (Contrast with borrowerRepresentation.ts, which intentionally uses the
 * BROAD "any representation at all" notion for research-subject derivation.)
 *
 * This module is intentionally pure (no "server-only"): the async accessor takes
 * the Supabase client as a parameter, so the decision logic is unit-testable.
 */

function hasText(value?: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Legal borrower identity
// ─────────────────────────────────────────────────────────────────────────────

export type LegalBorrowerIdentityInput = {
  /** deals.borrower_id — the legacy legal-borrower FK (may be unset). */
  borrowerId?: string | null;
  /** deals.borrower_name — deal-level legal borrower display name. */
  borrowerName?: string | null;
  /** deals.name — deal name (used as a borrower display field). */
  dealName?: string | null;
  /** deals.display_name — deal-level display name. */
  displayName?: string | null;
  /** deal_borrower_story.legal_name — banker-entered legal name on memo inputs. */
  storyLegalName?: string | null;
};

/**
 * Pure decision: is the LEGAL borrower entity identified?
 *
 * Satisfied by the borrower FK OR any deal-level legal-borrower display field OR
 * the borrower story's legal_name. NOT satisfied by management/sponsor profiles —
 * those are a different credit concept (see hasManagementSponsorProfile).
 */
export function hasLegalBorrowerIdentity(input: LegalBorrowerIdentityInput): boolean {
  return (
    !!input.borrowerId ||
    hasText(input.borrowerName) ||
    hasText(input.dealName) ||
    hasText(input.displayName) ||
    hasText(input.storyLegalName)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Borrower narrative
// ─────────────────────────────────────────────────────────────────────────────

export type BorrowerNarrativeInput = {
  businessDescription?: string | null;
  revenueModel?: string | null;
  productsServices?: string | null;
};

/**
 * Pure decision: does the deal have a borrower business narrative? Gated in memo
 * readiness via missing_business_description / missing_revenue_model — exposed
 * here so the same notion is testable and reusable.
 */
export function hasBorrowerNarrative(input: BorrowerNarrativeInput): boolean {
  return (
    hasText(input.businessDescription) ||
    hasText(input.revenueModel) ||
    hasText(input.productsServices)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Management / sponsor / guarantor profile
// ─────────────────────────────────────────────────────────────────────────────

export type ManagementSponsorProfileInput = {
  /** Count of deal_management_profiles rows for the deal. */
  managementProfileCount: number;
};

/**
 * Pure decision: does the deal document at least one management / sponsor /
 * guarantor profile? Gated in memo readiness via missing_management_profile.
 */
export function hasManagementSponsorProfile(
  input: ManagementSponsorProfileInput,
): boolean {
  return input.managementProfileCount > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Async accessor — shared by deriveLifecycleState / verifyUnderwriteCore /
// computeNextStep so they can never disagree on "is the legal borrower attached?"
// ─────────────────────────────────────────────────────────────────────────────

type MinimalSb = {
  from: (table: string) => any;
};

export type DealLegalIdentityFields = {
  borrower_id?: string | null;
  borrower_name?: string | null;
  name?: string | null;
  display_name?: string | null;
};

/**
 * Async accessor: is the LEGAL borrower entity identified for this deal?
 *
 * Checks the deal-row fields first (no query needed), then falls back to the
 * borrower story's legal_name. Management/sponsor profiles are deliberately NOT
 * consulted. On query failure, returns false (treat as missing) — the safe
 * default both prior call sites used.
 */
export async function hasLegalBorrowerIdentityForDeal(
  sb: MinimalSb,
  dealId: string,
  deal: DealLegalIdentityFields | null | undefined,
): Promise<boolean> {
  if (
    hasLegalBorrowerIdentity({
      borrowerId: deal?.borrower_id,
      borrowerName: deal?.borrower_name,
      dealName: deal?.name,
      displayName: deal?.display_name,
    })
  ) {
    return true;
  }

  // Fall back to the banker-entered legal name on the borrower story.
  try {
    const { data } = await sb
      .from("deal_borrower_story")
      .select("legal_name")
      .eq("deal_id", dealId)
      .limit(1);
    const storyLegalName = Array.isArray(data)
      ? (data[0] as any)?.legal_name
      : (data as any)?.legal_name;
    return hasLegalBorrowerIdentity({ storyLegalName });
  } catch {
    return false;
  }
}
