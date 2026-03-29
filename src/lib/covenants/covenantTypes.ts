/**
 * Phase 55 — Covenant Recommendation Engine Types
 */

export type CovenantSource = "rule_engine" | "ai_recommended" | "banker_override";
export type CovenantSeverity = "required" | "recommended" | "optional";
export type TestingFrequency = "monthly" | "quarterly" | "semi_annual" | "annual";
export type DealType = "operating_company" | "real_estate" | "mixed_use";

export type FinancialCovenant = {
  id: string;
  name: string;
  category: "dscr" | "leverage" | "liquidity" | "debt_yield" | "occupancy" | "global_cash_flow";
  threshold: number;
  unit: "ratio" | "dollars" | "percentage";
  testingFrequency: TestingFrequency;
  testingBasis: string;
  draftLanguage: string;
  rationale: string;
  source: CovenantSource;
  severity: CovenantSeverity;
};

export type ReportingCovenant = {
  id: string;
  name: string;
  requirement: string;
  frequency: TestingFrequency | "annual" | "immediate";
  deadlineDays: number | null;
  draftLanguage: string;
  source: CovenantSource;
  severity: CovenantSeverity;
};

export type BehavioralCovenant = {
  id: string;
  name: string;
  covenantType: "affirmative" | "negative";
  draftLanguage: string;
  rationale: string;
  source: CovenantSource;
  severity: CovenantSeverity;
};

export type SpringingCovenant = {
  id: string;
  name: string;
  triggerCondition: string;
  triggerThreshold: number;
  triggerMetric: string;
  remedy: string;
  draftLanguage: string;
  source: CovenantSource;
};

export type CovenantPackage = {
  dealId: string;
  generatedAt: string;
  riskGrade: string;
  dealType: DealType;
  financial: FinancialCovenant[];
  reporting: ReportingCovenant[];
  affirmativeNegative: BehavioralCovenant[];
  springing: SpringingCovenant[];
  rationale: string;
  customizations: string[];
  bankerNotes: string;
  snapshotHash: string | null;
  ruleEngineVersion: string;
};
