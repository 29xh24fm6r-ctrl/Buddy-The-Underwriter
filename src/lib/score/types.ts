/**
 * Buddy SBA Score — type definitions.
 *
 * Deterministic, versioned, explainable. No LLM output ever lives in these
 * types — see brokerage-master-plan.md §7 + specs/brokerage/sprint-00-buddy-sba-score.md.
 */

export type ScoreBand =
  | "institutional_prime"
  | "strong_fit"
  | "selective_fit"
  | "specialty_lender"
  | "not_eligible";

export type RateCardTier = "best" | "standard" | "widened" | "widest";

export type ScoreStatus = "draft" | "locked" | "superseded";

export type ComputationContext =
  | "manual"
  | "concierge_fact_change"
  | "document_upload"
  | "package_seal"
  | "marketplace_relist";

export type SubFactorScore = {
  name: string;
  rawScore: number | null; // 0–5, null when input missing
  weight: number;
  value: string | number | null;
  source: string; // "table.column" citation
  narrative: string;
};

export type ComponentScore = {
  componentName: string;
  rawScore: number; // 0–5 after sub-factor re-normalization
  weight: number; // 0–1
  contribution: number; // rawScore * weight * 20 (contribution to 0–100)
  subFactors: SubFactorScore[];
  narrative: string;
  missingInputs: string[];
  /** True when >50% of sub-factor weight was missing — component marked insufficient. */
  insufficientData: boolean;
};

export type EligibilityFailure = {
  check: string; // machine-readable id
  category:
    | "for_profit"
    | "size_standard"
    | "use_of_proceeds"
    | "passive"
    | "franchise"
    | "hard_blocker"
    | "other";
  reason: string;
  sopReference: string;
};

export type EligibilityCheck = {
  check: string;
  category: EligibilityFailure["category"];
  passed: boolean;
  detail?: string;
  sopReference: string;
};

export type EligibilityResult = {
  passed: boolean;
  failures: EligibilityFailure[];
  checks: EligibilityCheck[];
};

export type BuddySBAScore = {
  /** Populated on insert only; undefined for not-yet-persisted objects. */
  id?: string;
  dealId: string;
  bankId: string;
  scoreVersion: string;
  scoreStatus: ScoreStatus;
  lockedAt: string | null;

  eligibilityPassed: boolean;
  eligibilityFailures: EligibilityFailure[];

  score: number; // 0–100
  band: ScoreBand;
  rateCardTier: RateCardTier | null;

  borrowerStrength: ComponentScore;
  businessStrength: ComponentScore;
  dealStructure: ComponentScore;
  repaymentCapacity: ComponentScore;
  franchiseQuality: ComponentScore | null;

  narrative: string;
  topStrengths: string[];
  topWeaknesses: string[];

  inputSnapshot: Record<string, unknown>;
  weightsSnapshot: Record<string, number>;
  computationContext: ComputationContext;

  computedAt?: string;
};
