import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export type SbaEligibilityStatus = "eligible" | "conditional" | "ineligible";

export type SbaEligibilityInput = {
  snapshot: DealFinancialSnapshotV1;
  borrowerEntityType: string | null;
  useOfProceeds: string[] | null;
  dealType: string | null;
  loanProductType: string | null;
};

export type SbaEligibilityResult = {
  status: SbaEligibilityStatus;
  reasons: string[];
  missing: string[];
};

const INELIGIBLE_ENTITY_TYPES = ["NONPROFIT", "GOVERNMENT", "PUBLIC_ENTITY"];
const INELIGIBLE_UOP_FLAGS = ["SPECULATIVE", "PASSIVE_INVESTMENT", "GAMBLING", "ILLEGAL_ACTIVITY"];

function normalizeEnum(value: string | null | undefined): string | null {
  if (!value) return null;
  return String(value).trim().toUpperCase();
}

function normalizeList(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((v) => String(v).trim().toUpperCase()).filter(Boolean);
}

export function evaluateSbaEligibility(input: SbaEligibilityInput): SbaEligibilityResult {
  const reasons: string[] = [];
  const missing: string[] = [];

  const entityType = normalizeEnum(input.borrowerEntityType);
  const useOfProceeds = normalizeList(input.useOfProceeds);
  const dealType = normalizeEnum(input.dealType);
  const loanProductType = normalizeEnum(input.loanProductType);

  if (!entityType) missing.push("borrower_entity_type");
  if (!useOfProceeds.length) missing.push("use_of_proceeds");
  if (!dealType) missing.push("deal_type");
  if (!loanProductType) missing.push("loan_product_type");

  if (entityType && INELIGIBLE_ENTITY_TYPES.includes(entityType)) {
    reasons.push(`Borrower entity type ${entityType} is not SBA eligible.`);
  }

  const badUop = useOfProceeds.filter((u) => INELIGIBLE_UOP_FLAGS.includes(u));
  if (badUop.length) {
    reasons.push(`Use of proceeds includes ineligible categories: ${badUop.join(", ")}.`);
  }

  const dscr = input.snapshot.dscr?.value_num ?? null;
  if (typeof dscr === "number" && dscr < 1.0) {
    reasons.push(`DSCR ${dscr.toFixed(2)} is below the SBA minimum threshold.`);
  }

  let status: SbaEligibilityStatus = "eligible";
  if (reasons.length > 0) {
    status = reasons.some((r) => r.toLowerCase().includes("not sba eligible") || r.toLowerCase().includes("ineligible"))
      ? "ineligible"
      : "conditional";
  }

  if (missing.length > 0 && status === "eligible") {
    status = "conditional";
  }

  return {
    status,
    reasons,
    missing,
  };
}
