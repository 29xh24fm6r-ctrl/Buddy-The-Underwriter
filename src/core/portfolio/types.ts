// Phase 65N — Portfolio Intelligence Types
// Zero runtime imports. Pure type definitions only.

import type { SystemTier, CanonicalPrimaryAction } from "../relationship-decision/types";

// ─── Scope ────────────────────────────────────────────────────────────────────

export type PortfolioScope = {
  bankId: string;
  filteredByUserId?: string;
  filteredBySegment?: string;
};

// ─── Ranked Relationship ──────────────────────────────────────────────────────

export type RankedRelationship = {
  relationshipId: string;
  systemTier: SystemTier;
  rankPosition: number;
  drivers: {
    distress: boolean;
    deadline: boolean;
    borrowerBlock: boolean;
    protection: boolean;
    growth: boolean;
    value: boolean;
  };
  explanation: string;
  primaryAction: CanonicalPrimaryAction | null;
};

// ─── Portfolio Signal ─────────────────────────────────────────────────────────

export type PortfolioSignalType =
  | "deposit_runoff_cluster"
  | "renewal_wave"
  | "industry_stress_cluster"
  | "treasury_stall_cluster"
  | "growth_opportunity_cluster";

export type PortfolioSignal = {
  signalId: string;
  type: PortfolioSignalType;
  severity: "low" | "moderate" | "high" | "critical";
  relationshipIds: string[];
  explanation: string;
  evidenceIds: string[];
  detectedAt: string;
};

export type PortfolioSignalEvidenceRule = {
  minimumRelationshipCount: number;
  minimumSharedTraitCount: number;
  lookbackDays: number;
};

// ─── Portfolio Summary ────────────────────────────────────────────────────────

export type PortfolioSummary = {
  totalRelationships: number;
  distressCounts: {
    watchlist: number;
    workout: number;
  };
  upcomingDeadlines: number;
  borrowerBlocked: number;
  protectionExposure: number;
  growthOpportunities: number;
  topRisks: string[];
};

// ─── Portfolio Action ─────────────────────────────────────────────────────────

export type PortfolioActionCode =
  | "review_high_risk_cluster"
  | "rebalance_banker_focus"
  | "prioritize_renewals"
  | "address_deposit_runoff"
  | "advance_growth_cluster";

export type PortfolioActionabilityContract = {
  isActionableNow: boolean;
  actorType: "banker" | "team_lead" | "credit_admin";
  dueAt: string | null;
  closureCondition: string;
  evidenceIds: string[];
  deeplink: string;
};

export type PortfolioAction = {
  actionCode: PortfolioActionCode;
  scope: PortfolioScope;
  relationshipIds: string[];
  explanation: string;
  actionability: PortfolioActionabilityContract;
};

// ─── Portfolio Intelligence Pack ──────────────────────────────────────────────

export type PortfolioIntelligencePack = {
  scope: PortfolioScope;
  generatedAt: string;
  orderedRelationships: RankedRelationship[];
  signals: PortfolioSignal[];
  summary: PortfolioSummary;
  actions: PortfolioAction[];
  diagnostics: {
    version: string;
    inputSources: string[];
    degraded: boolean;
  };
};

// ─── Ranking Input ────────────────────────────────────────────────────────────

export type PortfolioRelationshipInput = {
  relationshipId: string;
  systemTier: SystemTier;
  primaryAction: CanonicalPrimaryAction | null;
  severityWeight: number;
  deadlineWeight: number;
  exposureWeight: number;
  evidenceWeight: number;
  policyWeight: number;
  ageWeight: number;
  hasDistress: boolean;
  hasDeadline: boolean;
  hasBorrowerBlock: boolean;
  hasProtection: boolean;
  hasGrowth: boolean;
  hasHighValue: boolean;
  whyNow: string;
};

// ─── Signal Detection Input ───────────────────────────────────────────────────

export type SignalDetectionInput = {
  relationships: Array<{
    relationshipId: string;
    systemTier: SystemTier;
    queueReasons: string[];
    hasDepositRunoff: boolean;
    hasRenewalDue: boolean;
    industryCode: string | null;
    hasTreasuryStall: boolean;
    hasGrowthOpportunity: boolean;
    evidenceIds: string[];
  }>;
  nowIso: string;
};

// ─── Omega adapter ────────────────────────────────────────────────────────────

export type OmegaPrimePortfolioContext = {
  bankId: string;
  topRelationships: Array<{
    relationshipId: string;
    tier: SystemTier;
    primaryActionCode: string | null;
    explanation: string;
  }>;
  activeSignals: Array<{
    type: PortfolioSignalType;
    severity: string;
    relationshipCount: number;
  }>;
  summary: PortfolioSummary;
  portfolioActions: Array<{
    actionCode: PortfolioActionCode;
    explanation: string;
  }>;
};
