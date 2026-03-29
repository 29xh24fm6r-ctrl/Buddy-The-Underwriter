// Phase 65O — Banker Copilot (Omega Advisory Layer) Types
// Zero runtime imports. Pure type definitions only.

import type { RelationshipSurfaceItem, RelationshipSurfaceTimelineEntry, RelationshipSurfaceCaseRef, RelationshipEvidenceEnvelope } from "../relationship-surface/types";
import type { PortfolioSummary } from "../portfolio/types";

// ─── Omega Input Contract ─────────────────────────────────────────────────────

export type OmegaRelationshipContext = {
  relationship: RelationshipSurfaceItem;
  portfolio?: PortfolioSummary;
  canonicalFacts: {
    relationshipState: string;
    blockers: string[];
    nextActions: string[];
    health: string;
  };
  signals: {
    growth?: Record<string, unknown>;
    protection?: Record<string, unknown>;
    crypto?: Record<string, unknown>;
    operations?: Record<string, unknown>;
  };
  evidence: RelationshipEvidenceEnvelope[];
  timeline: RelationshipSurfaceTimelineEntry[];
  openCases: RelationshipSurfaceCaseRef[];
};

// ─── Omega Outputs ────────────────────────────────────────────────────────────

export type OmegaRelationshipExplanation = {
  summary: string;
  keyDrivers: string[];
  whatChanged: string[];
};

export type OmegaRecommendation = {
  action: string;
  reasoning: string;
  priority: "high" | "medium" | "low";
  relatedCanonicalAction?: string;
};

export type OmegaRiskNarrative = {
  currentRisk: string;
  forwardRisk: string;
  keyUncertainties: string[];
};

export type OmegaBorrowerMessage = {
  subject: string;
  body: string;
};

export type OmegaInternalNote = {
  summary: string;
  bullets: string[];
};

export type OmegaCommunication = {
  borrowerMessage: OmegaBorrowerMessage;
  internalNote: OmegaInternalNote;
};

export type OmegaScenario = {
  scenario: string;
  outcome: string;
  likelihood: "low" | "medium" | "high";
};

// ─── Full Omega Response ──────────────────────────────────────────────────────

export type OmegaRelationshipAdvisory = {
  explanation: OmegaRelationshipExplanation;
  recommendations: OmegaRecommendation[];
  riskNarrative: OmegaRiskNarrative;
  communication: OmegaCommunication;
  scenarios: OmegaScenario[];
  meta: {
    advisory: true;
    generatedAt: string;
    contextHash: string;
    model: string;
  };
};

export type OmegaPortfolioAdvisory = {
  narrative: string;
  keyRisks: string[];
  focusRecommendations: string[];
  meta: {
    advisory: true;
    generatedAt: string;
    model: string;
  };
};
