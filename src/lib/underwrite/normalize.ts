// src/lib/underwrite/normalize.ts
import type { NormalizedUnderwrite, FieldWithSource } from "@/lib/underwrite/types";

function field<T>(value: T | null, source: FieldWithSource<T>["source"]): FieldWithSource<T> {
  return { value: value ?? null, source };
}

function firstNonNull<T>(...candidates: Array<FieldWithSource<T>>): FieldWithSource<T> {
  for (const c of candidates) {
    if (c.value !== null && c.value !== undefined && c.value !== ("" as any)) return c;
  }
  return candidates[candidates.length - 1] ?? field<T>(null, { from: "default" });
}

function latestByCreatedAt<T extends { created_at: string }>(rows: T[]): T | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

/**
 * Normalize underwriting variables:
 * Priority order:
 * - banker underwrite input (authoritative structure)
 * - borrower request (intent)
 * - doc facts (supporting factual context) [never overrides banker structure]
 * - defaults
 */
export function normalizeUnderwrite(input: {
  dealId: string;
  borrowerRequests: any[];
  bankerUnderwriteInputs: any[];
  docFacts: Record<string, any>;
}): NormalizedUnderwrite {
  const borrowerLatest = latestByCreatedAt(input.borrowerRequests as any[]) as any | null;
  const bankerLatest = latestByCreatedAt(input.bankerUnderwriteInputs as any[]) as any | null;

  const requestedProducts = Array.from(
    new Set((input.borrowerRequests ?? []).map((r: any) => String(r.product_type)).filter(Boolean))
  );

  // NOTE: docFacts are included but do not override banker structure.
  // In future we can map docFacts into purpose/collateral summaries as *suggestions*.
  const docFacts = input.docFacts ?? {};

  const primaryProductType = firstNonNull<string>(
    bankerLatest
      ? field(String(bankerLatest.proposed_product_type ?? null), { from: "banker_underwrite_input", id: bankerLatest.id })
      : field(null, { from: "default" }),
    borrowerLatest
      ? field(String(borrowerLatest.product_type ?? null), { from: "borrower_loan_request", id: borrowerLatest.id })
      : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  // Core structure (banker wins)
  const amount = firstNonNull<number>(
    bankerLatest ? field(bankerLatest.proposed_amount ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    borrowerLatest ? field(borrowerLatest.requested_amount ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const termMonths = firstNonNull<number>(
    bankerLatest ? field(bankerLatest.proposed_term_months ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    borrowerLatest ? field(borrowerLatest.requested_term_months ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const amortMonths = firstNonNull<number>(
    bankerLatest ? field(bankerLatest.proposed_amort_months ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    borrowerLatest ? field(borrowerLatest.requested_amort_months ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const interestOnlyMonths = firstNonNull<number>(
    bankerLatest ? field(bankerLatest.proposed_interest_only_months ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    borrowerLatest ? field(borrowerLatest.requested_interest_only_months ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const rateType = firstNonNull<"FIXED" | "VARIABLE">(
    bankerLatest ? field(bankerLatest.proposed_rate_type ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    borrowerLatest ? field(borrowerLatest.requested_rate_type ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const rateIndex = firstNonNull<string>(
    bankerLatest ? field(bankerLatest.proposed_rate_index ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    borrowerLatest ? field(borrowerLatest.requested_rate_index ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const spreadBps = firstNonNull<number>(
    bankerLatest ? field(bankerLatest.proposed_spread_bps ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    borrowerLatest ? field(borrowerLatest.requested_spread_bps ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  // Narrative/purpose (borrower wins; docFacts can be displayed but not override)
  const purpose = firstNonNull<string>(
    borrowerLatest ? field(borrowerLatest.purpose ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const useOfProceeds = firstNonNull<any>(
    borrowerLatest ? field(borrowerLatest.use_of_proceeds ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const collateralSummary = firstNonNull<string>(
    borrowerLatest ? field(borrowerLatest.collateral_summary ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const guarantorsSummary = firstNonNull<string>(
    borrowerLatest ? field(borrowerLatest.guarantors_summary ?? null, { from: "borrower_loan_request", id: borrowerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  // Underwrite targets (banker-only)
  const guaranteePercent = firstNonNull<number>(
    bankerLatest ? field(bankerLatest.guarantee_percent ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const ltvTarget = firstNonNull<number>(
    bankerLatest ? field(bankerLatest.ltv_target ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const dscrTarget = firstNonNull<number>(
    bankerLatest ? field(bankerLatest.dscr_target ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const globalDscrTarget = firstNonNull<number>(
    bankerLatest ? field(bankerLatest.global_dscr_target ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  const pricingFloorRate = firstNonNull<number>(
    bankerLatest ? field(bankerLatest.pricing_floor_rate ?? null, { from: "banker_underwrite_input", id: bankerLatest.id }) : field(null, { from: "default" }),
    field(null, { from: "default" })
  );

  return {
    dealId: input.dealId,
    primaryProductType,
    requestedProducts,

    amount,
    termMonths,
    amortMonths,
    interestOnlyMonths,
    rateType,
    rateIndex,
    spreadBps,

    purpose,
    useOfProceeds,
    collateralSummary,
    guarantorsSummary,

    guaranteePercent,
    ltvTarget,
    dscrTarget,
    globalDscrTarget,
    pricingFloorRate,

    docFacts,

    selected: {
      borrowerRequestId: borrowerLatest?.id ?? null,
      bankerUnderwriteInputId: bankerLatest?.id ?? null,
    },
  };
}
