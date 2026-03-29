// Phase 65L — Relationship OS Command Surface Types
// Zero runtime imports. Pure type definitions only.

// ─── Domain & Classification ──────────────────────────────────────────────────

export type RelationshipSurfaceDomain =
  | "truth"
  | "operations"
  | "growth"
  | "protection"
  | "crypto";

export type RelationshipSurfaceActionability =
  | "execute_now"
  | "open_panel"
  | "review_required"
  | "waiting_on_borrower"
  | "monitor_only"
  | "approval_required";

export type RelationshipSurfacePriorityBucket =
  | "critical"
  | "urgent"
  | "watch"
  | "healthy";

export type RelationshipSurfaceReasonFamily =
  | "integrity"
  | "review"
  | "borrower"
  | "monitoring"
  | "renewal"
  | "growth"
  | "protection"
  | "crypto"
  | "informational";

// ─── Evidence Envelope ────────────────────────────────────────────────────────

export type RelationshipEvidenceEnvelope = {
  sourceLayer:
    | "truth"
    | "operations"
    | "growth"
    | "protection"
    | "crypto";
  sourceObjectType:
    | "snapshot"
    | "opportunity"
    | "case"
    | "event"
    | "position"
    | "package";
  sourceObjectId: string | null;
  facts: Record<string, unknown>;
};

// ─── Surface Action ───────────────────────────────────────────────────────────

export type RelationshipSurfaceAction = {
  actionCode: string;
  label: string;
  domain: RelationshipSurfaceDomain;
  actionability: RelationshipSurfaceActionability;
  priority: "critical" | "high" | "normal" | "low";
  href: string | null;
  evidence: RelationshipEvidenceEnvelope;
};

// ─── Case Reference ──────────────────────────────────────────────────────────

export type RelationshipSurfaceCaseRef = {
  caseType:
    | "annual_review"
    | "renewal"
    | "expansion"
    | "protection"
    | "crypto_protection";
  caseId: string;
  status: string;
  ownerUserId: string | null;
  openedAt: string;
};

// ─── Timeline Entry ──────────────────────────────────────────────────────────

export type RelationshipSurfaceTimelineEntry = {
  sourceLayer:
    | "relationship"
    | "treasury"
    | "expansion"
    | "protection"
    | "crypto";
  eventCode: string;
  eventAt: string;
  title: string;
  summary: string;
  severity: "normal" | "warning" | "critical";
  href: string | null;
};

// ─── Evidence Summary ─────────────────────────────────────────────────────────

export type RelationshipSurfaceEvidenceSummary = {
  reasonCount: number;
  blockerCount: number;
  caseCount: number;
  lastMaterialChangeAt: string | null;
};

// ─── Surface Item (main render object per relationship) ───────────────────────

export type RelationshipSurfaceItem = {
  relationshipId: string;
  bankId: string;

  canonicalState: string;
  health: string;
  blockingParty: "banker" | "borrower" | "portfolio" | "system" | "none";

  priorityBucket: RelationshipSurfacePriorityBucket;
  priorityScore: number;

  primaryReasonCode: string;
  primaryReasonFamily: RelationshipSurfaceReasonFamily;
  primaryReasonLabel: string;
  primaryReasonDescription: string;

  primaryActionCode: string | null;
  primaryActionLabel: string | null;
  primaryActionability: RelationshipSurfaceActionability;
  isPrimaryActionExecutable: boolean;

  changedSinceViewed: boolean;
  computedAt: string;

  explanationLines: string[];
  supportingActions: RelationshipSurfaceAction[];
  evidenceSummary: RelationshipSurfaceEvidenceSummary;

  openCases: RelationshipSurfaceCaseRef[];
  timelinePreview: RelationshipSurfaceTimelineEntry[];
};

// ─── Case Presentation ────────────────────────────────────────────────────────

export type RelationshipCasePresentation = {
  caseType:
    | "annual_review"
    | "renewal"
    | "expansion"
    | "protection"
    | "crypto_protection";
  status: string;
  title: string;
  summary: string;
  ownerUserId: string | null;
  openedAt: string;
  dueAt: string | null;
  href: string | null;
  severity: "normal" | "warning" | "critical";
};

// ─── Reason Catalog Entry ─────────────────────────────────────────────────────

export type RelationshipSurfaceReasonEntry = {
  code: string;
  family: RelationshipSurfaceReasonFamily;
  label: string;
  description: string;
  precedence: number;
  severity: "normal" | "warning" | "critical";
  defaultActionability: RelationshipSurfaceActionability;
};

// ─── Priority Derivation Input ────────────────────────────────────────────────

export type PriorityDerivationInput = {
  reasonCodes: string[];
  openCases: RelationshipSurfaceCaseRef[];
  blockerCount: number;
  hasIntegrityIssue: boolean;
  hasCriticalMonitoring: boolean;
  hasCriticalRenewal: boolean;
  hasCryptoLiquidationReview: boolean;
  hasCriticalProtection: boolean;
  hasCureExpired: boolean;
  hasRenewalOverdue: boolean;
  hasAnnualReviewOverdue: boolean;
  hasBankerDeadline: boolean;
  hasBorrowerOverdue: boolean;
  hasTreasuryStall: boolean;
  hasMarginCurePending: boolean;
  hasProtectionWork: boolean;
  hasGrowthWork: boolean;
};

// ─── Changed Since Viewed Input ───────────────────────────────────────────────

export type ChangedSinceViewedInput = {
  currentPrimaryReasonCode: string;
  currentPrimaryActionCode: string | null;
  currentPriorityBucket: RelationshipSurfacePriorityBucket;
  lastAcknowledgedReasonCode: string | null;
  lastAcknowledgedAt: string | null;
  latestBorrowerActivityAt: string | null;
  latestAutoProgressAt: string | null;
  latestCaseOpenedAt: string | null;
  latestCriticalEventAt: string | null;
  latestCryptoDistressAt: string | null;
  previousPriorityBucket: RelationshipSurfacePriorityBucket | null;
};

// ─── Command Surface Response Shapes ──────────────────────────────────────────

export type CommandSurfaceListResponse = {
  summary: {
    total: number;
    critical: number;
    urgent: number;
    watch: number;
    healthy: number;
  };
  items: RelationshipSurfaceItem[];
  computedAt: string;
};

export type CommandSurfaceSingleResponse = {
  item: RelationshipSurfaceItem;
  timeline: RelationshipSurfaceTimelineEntry[];
  computedAt: string;
};
