import "server-only";

/**
 * Credit Memo Bindings — the data contract between facts/spreads and the memo.
 *
 * Non-negotiable: every numeric field shown in the memo must have a provenance entry.
 */

export type OwnerTypeBinding = "DEAL" | "PERSONAL" | "GLOBAL";

export type CreditMemoProvenance = {
  memoField: string;                // e.g. "property.noi", "sponsors[0].totalPersonalIncome"
  factType?: string;                // e.g. "FINANCIAL_ANALYSIS"
  factKey?: string;                 // e.g. "NOI_TTM"
  ownerType: OwnerTypeBinding;
  ownerEntityId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  sourceDocumentId?: string | null;
  confidence?: number | null;
  source: string;                   // human-readable provenance, e.g. "Facts:FINANCIAL_ANALYSIS.NOI_TTM"
};

export type SponsorBinding = {
  ownerEntityId: string;
  name: string | null;

  // Personal income (from 1040)
  totalPersonalIncome: number | null;
  wagesW2: number | null;
  schedENet: number | null;
  k1OrdinaryIncome: number | null;

  // PFS
  totalAssets: number | null;
  totalLiabilities: number | null;
  netWorth: number | null;
};

export type CreditMemoBindings = {
  dealId: string;
  bankId: string;
  generatedAt: string;

  // Period selections (discovered from facts, never hardcoded)
  periods: {
    fiscal: Array<{ start: string; end: string }>;
    interim: { start: string; end: string } | null;
  };

  // Deal / Property (owner_type = DEAL)
  property: {
    noi: number | null;
    totalIncome: number | null;
    opex: number | null;
    cashFlowAvailable: number | null;
    debtService: number | null;
    excessCashFlow: number | null;
    dscr: number | null;
    dscrStressed: number | null;
    ltvGross: number | null;
    ltvNet: number | null;
    occupancyPct: number | null;
    inPlaceRent: number | null;
  };

  // Sponsor / Personal (owner_type = PERSONAL, per owner_entity_id)
  sponsors: SponsorBinding[];

  // Global (owner_type = GLOBAL — cross-entity aggregation)
  global: {
    globalCashFlow: number | null;
    globalDscr: number | null;
    cashAvailable: number | null;
    personalDebtService: number | null;
    livingExpenses: number | null;
    totalObligations: number | null;
  };

  // Data completeness summary (for the banner)
  completeness: {
    deal: { total: number; populated: number; status: "complete" | "partial" | "empty" };
    personal: { total: number; populated: number; status: "complete" | "partial" | "empty" };
    global: { total: number; populated: number; status: "complete" | "partial" | "empty" };
  };

  // Full provenance trail — every populated numeric field must have an entry
  provenance: CreditMemoProvenance[];
};
