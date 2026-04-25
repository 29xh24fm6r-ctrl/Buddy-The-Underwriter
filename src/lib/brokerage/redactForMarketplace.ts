import "server-only";

/**
 * Sprint 5 marketplace redactor — Layer 1, the security boundary.
 *
 * Pure function. Takes a SealedSnapshotInput (assembled by
 * buildSealedSnapshot) and returns the borrower-redacted KeyFactsSummary
 * that becomes the public face of the deal on the marketplace.
 *
 * Security invariants:
 *   - No precise $ amounts from operating history (bucketed / rounded)
 *   - No borrower identifiers (name, business name, city, ZIP, street)
 *   - Franchise brand disclosure requires ≥50 units nationally
 *   - SBA score and DSCRs are the preview signal — kept with one-decimal
 *     precision because the marketplace has no voice without them
 *
 * Layer 2 (anonymized narrative) and Layer 3 (PII scanner) are applied
 * downstream in buildKFS.ts. If this module has a bug, PII leaks.
 */

export const KFS_REDACTION_VERSION = "1.0.0";

export type KeyFactsSummary = {
  redactionVersion: string;

  sbaProgram: "7a" | "504" | "express";
  loanAmount: number; // rounded to nearest $25K
  termMonths: number;
  useOfProceeds: Array<{ category: string; amountBucket: string }>;
  equityInjectionAmount: number; // rounded to nearest $10K
  equityInjectionPct: number; // one decimal

  score: number;
  band:
    | "institutional_prime"
    | "strong_fit"
    | "selective_fit"
    | "specialty_lender";
  scoreComponents: {
    borrowerStrength: number;
    businessStrength: number;
    dealStructure: number;
    repaymentCapacity: number;
    franchiseQuality: number | null;
  };
  rateCardTier: "best" | "standard" | "widened" | "widest";

  sopEligibilityPassed: boolean;
  sopEligibilityChecks: Array<{ requirement: string; passed: boolean }>;
  riskGrade: "low" | "medium" | "high" | "very_high";

  dscrBaseHistorical: number | null;
  dscrBaseProjected: number;
  dscrStressProjected: number;
  globalCashFlowDscr: number | null;

  state: string;
  industryNaics: string;
  industryDescription: string;
  yearsInBusinessBucket: "startup" | "<2yr" | "2-5yr" | "5-10yr" | "10+yr";
  ficoBucket: "<680" | "680-720" | "720-760" | "760+" | "undisclosed";
  liquidityBucket: string;
  netWorthBucket: string;
  industryExperienceYears: number;

  franchiseBlock: {
    brandName: string | null;
    brandCategory: string;
    brandMaturityYears: number | null;
  } | null;

  feasibilityScore: number;
  feasibilityDimensions: {
    marketDemand: number;
    locationSuitability: number;
    financialViability: number;
    operationalReadiness: number;
  };

  packageManifest: {
    businessPlanPages: number;
    projectionsPages: number;
    feasibilityPages: number;
    formsIncluded: string[];
    sourceDocumentsCount: number;
  };

  anonymizedNarrative: string;
};

export type SealedSnapshotInput = {
  deal: {
    sba_program: string;
    loan_amount: number; // sourced from loan_impact.loanAmount
    term_months: number; // sourced from loan_impact.termMonths
    state: string;
    use_of_proceeds: Array<{ category: string; amount: number }>;
    equity_injection_amount: number;
  };
  score: {
    score: number;
    band: string;
    rateCardTier: string;
    scoreComponents: Record<string, number | null>;
    eligibility: {
      passed: boolean;
      checks: Array<{ check: string; passed: boolean }>;
    };
  };
  borrower: {
    fico_score: number | null;
    liquid_assets: number | null;
    net_worth: number | null;
    years_in_operation: number | null;
    industry_experience_years: number | null;
    industry_naics: string;
    industry_description: string;
  };
  financials: {
    dscr_base_historical: number | null;
    dscr_base_projected: number;
    dscr_stress_projected: number;
    global_cash_flow_dscr: number | null;
  };
  franchise: {
    brand_id: string | null;
    brand_name: string | null;
    brand_category: string | null;
    brand_unit_count: number | null;
    brand_founding_year: number | null;
  } | null;
  feasibility: {
    composite_score: number;
    market_demand_score: number;
    location_suitability_score: number;
    financial_viability_score: number;
    operational_readiness_score: number;
  };
  packageManifest: {
    businessPlanPages: number;
    projectionsPages: number;
    feasibilityPages: number;
    formsIncluded: string[];
    sourceDocumentsCount: number;
  };
};

export function redactForMarketplace(
  snapshot: SealedSnapshotInput,
): KeyFactsSummary {
  const ELIGIBLE_BANDS = [
    "institutional_prime",
    "strong_fit",
    "selective_fit",
    "specialty_lender",
  ];
  if (!ELIGIBLE_BANDS.includes(snapshot.score.band)) {
    throw new Error(
      `Cannot redact: band '${snapshot.score.band}' not rate-card-eligible. Sealing gate must reject before this.`,
    );
  }

  // Franchise disclosure: ≥50 units OR brandName=null.
  // Round-5: when is_franchise=true but brand isn't resolved (the common case
  // in Sprint 5 since no brand FK exists yet), brand_unit_count is null,
  // (null ?? 0) = 0 < 50, brandName stays null. Lenders see "franchise deal,
  // brand undisclosed."
  const franchiseBlock = snapshot.franchise
    ? {
        brandName:
          (snapshot.franchise.brand_unit_count ?? 0) >= 50
            ? snapshot.franchise.brand_name
            : null,
        brandCategory: snapshot.franchise.brand_category ?? "Unknown",
        brandMaturityYears:
          (snapshot.franchise.brand_unit_count ?? 0) >= 50 &&
          snapshot.franchise.brand_founding_year
            ? new Date().getFullYear() - snapshot.franchise.brand_founding_year
            : null,
      }
    : null;

  return {
    redactionVersion: KFS_REDACTION_VERSION,

    sbaProgram: snapshot.deal.sba_program as KeyFactsSummary["sbaProgram"],
    loanAmount: roundToBucket(snapshot.deal.loan_amount, 25_000),
    termMonths: snapshot.deal.term_months,
    useOfProceeds: snapshot.deal.use_of_proceeds.map((item) => ({
      category: item.category,
      amountBucket: bucketAmount(item.amount),
    })),
    equityInjectionAmount: roundToBucket(
      snapshot.deal.equity_injection_amount,
      10_000,
    ),
    equityInjectionPct:
      snapshot.deal.loan_amount > 0
        ? Math.round(
            (snapshot.deal.equity_injection_amount /
              snapshot.deal.loan_amount) *
              1000,
          ) / 10
        : 0,

    score: snapshot.score.score,
    band: snapshot.score.band as KeyFactsSummary["band"],
    scoreComponents: {
      borrowerStrength: Number(
        snapshot.score.scoreComponents.borrowerStrength ?? 0,
      ),
      businessStrength: Number(
        snapshot.score.scoreComponents.businessStrength ?? 0,
      ),
      dealStructure: Number(snapshot.score.scoreComponents.dealStructure ?? 0),
      repaymentCapacity: Number(
        snapshot.score.scoreComponents.repaymentCapacity ?? 0,
      ),
      franchiseQuality: snapshot.score.scoreComponents.franchiseQuality,
    },
    rateCardTier: snapshot.score.rateCardTier as KeyFactsSummary["rateCardTier"],

    sopEligibilityPassed: snapshot.score.eligibility.passed,
    sopEligibilityChecks: snapshot.score.eligibility.checks.map((c) => ({
      requirement: humanizeCheckName(c.check),
      passed: c.passed,
    })),
    riskGrade: bandToRiskGrade(snapshot.score.band),

    dscrBaseHistorical:
      snapshot.financials.dscr_base_historical != null
        ? Math.round(snapshot.financials.dscr_base_historical * 10) / 10
        : null,
    dscrBaseProjected:
      Math.round(snapshot.financials.dscr_base_projected * 10) / 10,
    dscrStressProjected:
      Math.round(snapshot.financials.dscr_stress_projected * 10) / 10,
    globalCashFlowDscr:
      snapshot.financials.global_cash_flow_dscr != null
        ? Math.round(snapshot.financials.global_cash_flow_dscr * 10) / 10
        : null,

    state: snapshot.deal.state,
    industryNaics: snapshot.borrower.industry_naics,
    industryDescription: snapshot.borrower.industry_description,
    yearsInBusinessBucket: bucketYearsInBusiness(
      snapshot.borrower.years_in_operation,
    ),
    ficoBucket: bucketFico(snapshot.borrower.fico_score),
    liquidityBucket: bucketLiquidity(snapshot.borrower.liquid_assets),
    netWorthBucket: bucketNetWorth(snapshot.borrower.net_worth),
    industryExperienceYears: snapshot.borrower.industry_experience_years ?? 0,

    franchiseBlock,

    feasibilityScore: snapshot.feasibility.composite_score,
    feasibilityDimensions: {
      marketDemand: snapshot.feasibility.market_demand_score,
      locationSuitability: snapshot.feasibility.location_suitability_score,
      financialViability: snapshot.feasibility.financial_viability_score,
      operationalReadiness: snapshot.feasibility.operational_readiness_score,
    },

    packageManifest: snapshot.packageManifest,

    anonymizedNarrative: "", // Layer 2 fills this in buildKFS.ts
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function roundToBucket(value: number, bucket: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return Math.round(value / bucket) * bucket;
}

function bucketAmount(amount: number): string {
  if (amount < 25_000) return "<$25K";
  if (amount < 100_000) return "$25K-$100K";
  if (amount < 250_000) return "$100K-$250K";
  if (amount < 500_000) return "$250K-$500K";
  if (amount < 1_000_000) return "$500K-$1M";
  if (amount < 2_500_000) return "$1M-$2.5M";
  return "$2.5M+";
}

function bucketFico(fico: number | null): KeyFactsSummary["ficoBucket"] {
  if (fico == null) return "undisclosed";
  if (fico >= 760) return "760+";
  if (fico >= 720) return "720-760";
  if (fico >= 680) return "680-720";
  return "<680";
}

function bucketLiquidity(amount: number | null): string {
  if (amount == null) return "undisclosed";
  if (amount < 50_000) return "<$50K";
  if (amount < 150_000) return "$50K-$150K";
  if (amount < 500_000) return "$150K-$500K";
  if (amount < 2_000_000) return "$500K-$2M";
  return "$2M+";
}

function bucketNetWorth(amount: number | null): string {
  if (amount == null) return "undisclosed";
  if (amount < 250_000) return "<$250K";
  if (amount < 1_000_000) return "$250K-$1M";
  if (amount < 5_000_000) return "$1M-$5M";
  return "$5M+";
}

function bucketYearsInBusiness(
  years: number | null,
): KeyFactsSummary["yearsInBusinessBucket"] {
  if (years == null || years === 0) return "startup";
  if (years < 2) return "<2yr";
  if (years < 5) return "2-5yr";
  if (years < 10) return "5-10yr";
  return "10+yr";
}

function bandToRiskGrade(band: string): KeyFactsSummary["riskGrade"] {
  switch (band) {
    case "institutional_prime":
      return "low";
    case "strong_fit":
      return "low";
    case "selective_fit":
      return "medium";
    case "specialty_lender":
      return "high";
    default:
      return "very_high";
  }
}

function humanizeCheckName(check: string): string {
  return check.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
