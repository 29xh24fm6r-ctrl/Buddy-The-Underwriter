/**
 * Owner Benefit Add-backs — God Tier Phase 2, Layer 3
 *
 * Systematically identifies and quantifies 7 categories of owner benefit
 * add-backs per spec Section Layer 3.
 * Pure function — no DB, no server imports.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OwnerBenefitCategory =
  | "excess_compensation"
  | "auto_personal_use"
  | "home_office_cell"
  | "family_compensation"
  | "owner_insurance"
  | "rent_normalization"
  | "travel_meals";

export type OwnerBenefitItem = {
  category: OwnerBenefitCategory;
  canonicalKey: string;
  amount: number;
  description: string;
  source: string;
  documentationRequired: boolean;
};

export type OwnerBenefitSummary = {
  totalAddbacks: number;
  adjustedEbitda: number;
  items: OwnerBenefitItem[];
  documentationGaps: string[];
};

export type OwnerBenefitInput = {
  reportedEbitda: number;

  // 3A. Excess owner compensation
  ownerCompensation: number | null;
  marketRateCompensation: number | null;

  // 3B. Auto / vehicle personal use
  autoExpense: number | null;
  businessUsePct: number | null; // 0–1; null = assume 0.65

  // 3C. Home office & cell phone
  homeOfficeExpense: number | null;
  cellPhoneExpense: number | null;

  // 3D. Family member salaries
  familyCompensation: number | null;
  familyMarketRate: number | null;

  // 3E. Owner-paid insurance / benefits
  ownerLifeInsurance: number | null;
  ownerHealthInsurance: number | null;
  ownerDisabilityInsurance: number | null;

  // 3F. Related-party rent normalization
  actualRent: number | null;
  marketRent: number | null;

  // 3G. Travel, meals, entertainment
  travelMealsTotal: number | null;
  personalPct: number | null; // 0–1; null = assume 0.50
};

// ---------------------------------------------------------------------------
// Default assumptions per spec
// ---------------------------------------------------------------------------

const DEFAULT_BUSINESS_USE_PCT = 0.65;
const DEFAULT_PERSONAL_TRAVEL_PCT = 0.50;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function computeOwnerBenefitAddbacks(
  input: OwnerBenefitInput,
): OwnerBenefitSummary {
  const items: OwnerBenefitItem[] = [];
  const documentationGaps: string[] = [];

  // --- 3A. Excess Owner Compensation ---
  if (
    input.ownerCompensation !== null &&
    input.marketRateCompensation !== null &&
    input.ownerCompensation > input.marketRateCompensation
  ) {
    const excess = input.ownerCompensation - input.marketRateCompensation;
    items.push({
      category: "excess_compensation",
      canonicalKey: "ADDBACK_EXCESS_COMPENSATION",
      amount: excess,
      description: `Owner comp $${fmtNum(input.ownerCompensation)} exceeds market rate $${fmtNum(input.marketRateCompensation)}`,
      source: "Form 1125-E / W-2",
      documentationRequired: false,
    });
  }

  // --- 3B. Auto / Vehicle Personal Use ---
  if (input.autoExpense !== null && input.autoExpense > 0) {
    const businessPct = input.businessUsePct ?? DEFAULT_BUSINESS_USE_PCT;
    const personalPortion = input.autoExpense * (1 - businessPct);
    if (personalPortion > 0) {
      items.push({
        category: "auto_personal_use",
        canonicalKey: "ADDBACK_AUTO_PERSONAL_USE",
        amount: personalPortion,
        description: `Personal portion of auto expense (${((1 - businessPct) * 100).toFixed(0)}% of $${fmtNum(input.autoExpense)})`,
        source: "Schedule C Line 9 / Form 4562",
        documentationRequired: input.businessUsePct === null,
      });
      if (input.businessUsePct === null) {
        documentationGaps.push("No mileage log provided — using default 65% business use");
      }
    }
  }

  // --- 3C. Home Office & Cell Phone ---
  if (input.homeOfficeExpense !== null && input.homeOfficeExpense > 0) {
    items.push({
      category: "home_office_cell",
      canonicalKey: "ADDBACK_HOME_OFFICE",
      amount: input.homeOfficeExpense,
      description: `Home office deduction (owner's home)`,
      source: "Schedule C Line 30",
      documentationRequired: false,
    });
  }
  if (input.cellPhoneExpense !== null && input.cellPhoneExpense > 0) {
    items.push({
      category: "home_office_cell",
      canonicalKey: "ADDBACK_CELL_PHONE",
      amount: input.cellPhoneExpense,
      description: `Cell phone expense claimed on business`,
      source: "Operating expenses",
      documentationRequired: false,
    });
  }

  // --- 3D. Family Member Salaries ---
  if (
    input.familyCompensation !== null &&
    input.familyMarketRate !== null &&
    input.familyCompensation > input.familyMarketRate
  ) {
    const excess = input.familyCompensation - input.familyMarketRate;
    items.push({
      category: "family_compensation",
      canonicalKey: "ADDBACK_FAMILY_COMPENSATION",
      amount: excess,
      description: `Family comp $${fmtNum(input.familyCompensation)} exceeds market rate $${fmtNum(input.familyMarketRate)}`,
      source: "W-2 / payroll records",
      documentationRequired: true,
    });
    documentationGaps.push("Family member role documentation required for compensation add-back");
  }

  // --- 3E. Owner-Paid Insurance / Benefits ---
  const insuranceTotal = sumValues([
    input.ownerLifeInsurance,
    input.ownerHealthInsurance,
    input.ownerDisabilityInsurance,
  ]);
  if (insuranceTotal > 0) {
    items.push({
      category: "owner_insurance",
      canonicalKey: "ADDBACK_OWNER_INSURANCE",
      amount: insuranceTotal,
      description: `Owner insurance (life/health/disability)`,
      source: "Schedule 1 / S-Corp shareholder benefits",
      documentationRequired: false,
    });
  }

  // --- 3F. Related-Party Rent Normalization ---
  if (input.actualRent !== null && input.marketRent !== null) {
    const diff = input.actualRent - input.marketRent;
    if (diff !== 0) {
      items.push({
        category: "rent_normalization",
        canonicalKey: "ADDBACK_RENT_NORMALIZATION",
        amount: Math.abs(diff),
        description: diff > 0
          ? `Above-market rent: actual $${fmtNum(input.actualRent)} vs market $${fmtNum(input.marketRent)} — add back excess`
          : `Below-market rent: actual $${fmtNum(input.actualRent)} vs market $${fmtNum(input.marketRent)} — add expense`,
        source: "Lease agreement / rent comps",
        documentationRequired: true,
      });
      if (diff < 0) {
        // Below-market rent means the business expense is understated
        // The "add-back" is actually negative — increases expense
        items[items.length - 1].amount = diff; // negative
      }
      documentationGaps.push("Market rent comparison documentation required");
    }
  }

  // --- 3G. Travel, Meals, Entertainment ---
  if (input.travelMealsTotal !== null && input.travelMealsTotal > 0) {
    const personalPct = input.personalPct ?? DEFAULT_PERSONAL_TRAVEL_PCT;
    const personalPortion = input.travelMealsTotal * personalPct;
    if (personalPortion > 0) {
      items.push({
        category: "travel_meals",
        canonicalKey: "ADDBACK_PERSONAL_TRAVEL_MEALS",
        amount: personalPortion,
        description: `Personal portion of travel/meals (${(personalPct * 100).toFixed(0)}% of $${fmtNum(input.travelMealsTotal)})`,
        source: "Operating expenses / Schedule C",
        documentationRequired: input.personalPct === null,
      });
      if (input.personalPct === null) {
        documentationGaps.push("No travel breakdown provided — using default 50% personal use");
      }
    }
  }

  // --- Compute totals ---
  let totalAddbacks = 0;
  for (const item of items) {
    totalAddbacks += item.amount;
  }

  const adjustedEbitda = input.reportedEbitda + totalAddbacks;

  return {
    totalAddbacks,
    adjustedEbitda,
    items,
    documentationGaps,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumValues(values: (number | null)[]): number {
  let sum = 0;
  for (const v of values) {
    if (v !== null) sum += v;
  }
  return sum;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
