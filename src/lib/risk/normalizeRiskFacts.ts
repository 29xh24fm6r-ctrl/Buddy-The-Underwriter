import crypto from "crypto";

export type RiskFacts = {
  borrower: {
    entity_name: string;
    guarantors: string[];
    sponsor_experience_years: number | null;
  };
  collateral: {
    property_type: string | null;
    address: string | null;
    occupancy: number | null;
    dscr: number | null;
    ltv: number | null;
    as_is_value: number | null;
    stabilized_value: number | null;
  };
  loan: {
    requested_amount: number | null;
    purpose: string | null;
    term_months: number | null;
    amort_months: number | null;
    recourse_type: string | null;
  };
  financial: {
    noi: number | null;
    ebitda: number | null;
    cash_on_cash: number | null;
    liquidity: number | null;
    net_worth: number | null;
  };
  exceptions: Array<{
    policy: string;
    description: string;
    severity: "low" | "medium" | "high";
  }>;
};

/**
 * Normalize deal_context_snapshots.context into structured risk_facts
 * 
 * This is deterministic normalization - same snapshot should produce same facts_hash
 */
export function normalizeRiskFacts(snapshotContext: any): {
  facts: RiskFacts;
  facts_hash: string;
  confidence: Record<string, number>;
} {
  const ctx = snapshotContext || {};

  // Extract borrower info
  const borrower = {
    entity_name: ctx.borrower?.legal_name ?? ctx.borrower?.name ?? ctx.name ?? "Unknown",
    guarantors: (ctx.guarantors ?? []).map((g: any) => g.name ?? g.full_name ?? "Unknown"),
    sponsor_experience_years: ctx.sponsor?.experience_years ?? null,
  };

  // Extract collateral info
  const collateral = {
    property_type: ctx.collateral?.property_type ?? ctx.property_type ?? null,
    address: ctx.collateral?.address ?? ctx.property_address ?? null,
    occupancy: ctx.collateral?.occupancy ?? ctx.occupancy ?? null,
    dscr: ctx.financial?.dscr ?? ctx.dscr ?? null,
    ltv: ctx.financial?.ltv ?? ctx.ltv ?? null,
    as_is_value: ctx.collateral?.as_is_value ?? ctx.as_is_value ?? null,
    stabilized_value: ctx.collateral?.stabilized_value ?? ctx.stabilized_value ?? null,
  };

  // Extract loan request
  const loan = {
    requested_amount: ctx.loan?.requested_amount ?? ctx.requested_amount ?? null,
    purpose: ctx.loan?.purpose ?? ctx.purpose ?? null,
    term_months: ctx.loan?.term_months ?? ctx.term_months ?? null,
    amort_months: ctx.loan?.amort_months ?? ctx.amort_months ?? null,
    recourse_type: ctx.loan?.recourse_type ?? ctx.recourse_type ?? null,
  };

  // Extract financial metrics
  const financial = {
    noi: ctx.financial?.noi ?? ctx.noi ?? null,
    ebitda: ctx.financial?.ebitda ?? ctx.ebitda ?? null,
    cash_on_cash: ctx.financial?.cash_on_cash ?? null,
    liquidity: ctx.sponsor?.liquidity ?? ctx.liquidity ?? null,
    net_worth: ctx.sponsor?.net_worth ?? ctx.net_worth ?? null,
  };

  // Extract policy exceptions
  const exceptions = (ctx.policy_exceptions ?? ctx.exceptions ?? []).map((e: any) => ({
    policy: e.policy ?? e.name ?? "Unknown",
    description: e.description ?? e.reason ?? "",
    severity: (e.severity ?? "medium") as "low" | "medium" | "high",
  }));

  const facts: RiskFacts = {
    borrower,
    collateral,
    loan,
    financial,
    exceptions,
  };

  // Compute deterministic hash
  const canonical = JSON.stringify(facts, Object.keys(facts).sort());
  const facts_hash = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);

  // Compute confidence (simple heuristic based on non-null fields)
  const confidence: Record<string, number> = {
    borrower: computeConfidence(borrower),
    collateral: computeConfidence(collateral),
    loan: computeConfidence(loan),
    financial: computeConfidence(financial),
  };

  return { facts, facts_hash, confidence };
}

function computeConfidence(obj: any): number {
  const keys = Object.keys(obj);
  if (keys.length === 0) return 0;
  
  const nonNull = keys.filter(k => {
    const val = obj[k];
    if (Array.isArray(val)) return val.length > 0;
    return val !== null && val !== undefined && val !== "";
  });
  
  return Math.round((nonNull.length / keys.length) * 100) / 100;
}
