// src/lib/finance/underwriting/verdict.ts

export type UnderwritingVerdictLevel = "approve" | "caution" | "decline_risk";

export type UnderwritingVerdict = {
  level: UnderwritingVerdictLevel;
  headline: string;
  rationale: string[];
  key_drivers: string[];
  mitigants: string[];
};