// Phase 65K.5 — Crypto Relationship Extension Types
// Zero runtime imports. Pure type definitions only.

// ─── Enums ────────────────────────────────────────────────────────────────────

export type CryptoRelationshipStatus =
  | "not_applicable"
  | "monitored"
  | "warning"
  | "margin_call_open"
  | "cure_pending"
  | "liquidation_review_required"
  | "resolved"
  | "stalled";

export type CryptoCollateralHealth =
  | "healthy"
  | "pressured"
  | "stressed"
  | "critical"
  | "unknown";

export type CryptoValuationStatus =
  | "current"
  | "stale"
  | "unavailable";

export type CryptoCustodyStatus =
  | "unverified"
  | "verified"
  | "transfer_pending"
  | "control_issue";

export type LiquidationApprovalStatus =
  | "not_applicable"
  | "review_required"
  | "approved"
  | "declined"
  | "executed";

export type CryptoProtectionReadiness =
  | "not_applicable"
  | "review_required"
  | "ready"
  | "active_case_open"
  | "stalled"
  | "resolved";

export type CryptoPositionStatus =
  | "active"
  | "released"
  | "liquidated"
  | "closed";

export type CryptoMonitoringCadence =
  | "daily"
  | "12h"
  | "6h"
  | "1h"
  | "15m"
  | "manual";

export type CryptoMonitoringProgramStatus =
  | "active"
  | "paused"
  | "closed";

export type CryptoMarginEventType =
  | "warning_triggered"
  | "margin_call_opened"
  | "cure_started"
  | "cure_failed"
  | "liquidation_review_opened"
  | "liquidation_approved"
  | "liquidation_declined"
  | "liquidation_executed"
  | "resolved";

export type CryptoMarginEventStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "cancelled"
  | "expired";

export type CryptoProtectionCaseStatus =
  | "open"
  | "banker_review_required"
  | "ready"
  | "borrower_cure_open"
  | "in_progress"
  | "resolved"
  | "stalled"
  | "closed";

export type CryptoEventActorType =
  | "system"
  | "banker"
  | "borrower"
  | "cron"
  | "migration"
  | "custody_webhook";

// ─── Reason Codes ─────────────────────────────────────────────────────────────

export type CryptoReasonCode =
  | "valuation_stale"
  | "custody_unverified"
  | "warning_threshold_breached"
  | "margin_call_threshold_breached"
  | "liquidation_threshold_breached"
  | "cure_period_open"
  | "cure_period_expired"
  | "ltv_deteriorating"
  | "price_gap_unresolved"
  | "crypto_monitoring_stalled";

export type CryptoReasonSeverity = "low" | "medium" | "high" | "critical";

export interface CryptoReasonEntry {
  code: CryptoReasonCode;
  severity: CryptoReasonSeverity;
  evidence: Record<string, unknown>;
}

// ─── Event Codes ──────────────────────────────────────────────────────────────

export type RelationshipCryptoEventCode =
  | "crypto_position_recorded"
  | "crypto_price_snapshot_ingested"
  | "crypto_ltv_changed"
  | "crypto_warning_triggered"
  | "crypto_margin_call_opened"
  | "crypto_cure_started"
  | "crypto_cure_failed"
  | "crypto_liquidation_review_opened"
  | "crypto_liquidation_approved"
  | "crypto_liquidation_declined"
  | "crypto_liquidation_executed"
  | "crypto_custody_verified"
  | "crypto_custody_issue_detected"
  | "crypto_resolved";

// ─── Action Codes ─────────────────────────────────────────────────────────────

export type CryptoActionCode =
  | "review_crypto_collateral"
  | "refresh_crypto_valuation"
  | "verify_custody_control"
  | "open_margin_call"
  | "advance_crypto_cure"
  | "review_liquidation_request"
  | "approve_liquidation"
  | "resolve_crypto_distress";

// ─── Blocker Codes ────────────────────────────────────────────────────────────

export type CryptoBlockerCode =
  | "crypto_valuation_unavailable"
  | "crypto_custody_unverified"
  | "crypto_warning_open"
  | "crypto_margin_call_open"
  | "crypto_cure_pending"
  | "crypto_liquidation_review_required"
  | "crypto_monitoring_stalled";

export type CryptoBlockingParty =
  | "system"
  | "banker"
  | "borrower"
  | "committee"
  | "ops";

export interface CryptoBlocker {
  code: CryptoBlockerCode;
  blockingParty: CryptoBlockingParty;
  description: string;
  evidence: Record<string, unknown>;
}

// ─── Domain Objects ───────────────────────────────────────────────────────────

export interface CryptoCollateralPosition {
  id: string;
  relationshipId: string;
  bankId: string;
  dealId: string | null;

  assetSymbol: string;
  custodyProvider: string | null;
  custodyAccountRef: string | null;

  pledgedUnits: number;
  eligibleAdvanceRate: number | null;
  haircutPercent: number | null;

  marketValueUsd: number | null;
  collateralValueUsd: number | null;
  securedExposureUsd: number | null;
  currentLtv: number | null;

  warningLtvThreshold: number;
  marginCallLtvThreshold: number;
  liquidationLtvThreshold: number;

  custodyStatus: CryptoCustodyStatus;
  valuationStatus: CryptoValuationStatus;
  positionStatus: CryptoPositionStatus;

  evidence: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CryptoPriceSnapshot {
  id: string;
  relationshipId: string;
  bankId: string;
  assetSymbol: string;
  priceSource: string;
  referencePriceUsd: number;
  sourceTimestamp: string;
  ingestedAt: string;
  evidence: Record<string, unknown>;
}

export interface CryptoMarginEvent {
  id: string;
  relationshipId: string;
  bankId: string;
  collateralPositionId: string;
  eventType: CryptoMarginEventType;
  status: CryptoMarginEventStatus;
  ltvAtEvent: number | null;
  thresholdAtEvent: number | null;
  cureDueAt: string | null;
  resolvedAt: string | null;
  borrowerPackageId: string | null;
  approvalRequired: boolean;
  approvalStatus: LiquidationApprovalStatus;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface CryptoMonitoringProgram {
  id: string;
  relationshipId: string;
  bankId: string;
  status: CryptoMonitoringProgramStatus;
  cadence: CryptoMonitoringCadence;
  triggerMode: string;
  lastEvaluatedAt: string | null;
  nextEvaluateAt: string | null;
  config: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

export interface CryptoProtectionCase {
  id: string;
  relationshipId: string;
  bankId: string;
  marginEventId: string;
  status: CryptoProtectionCaseStatus;
  ownerUserId: string | null;
  bankerReviewRequired: boolean;
  bankerReviewCompletedAt: string | null;
  bankerReviewCompletedBy: string | null;
  outcome: Record<string, unknown>;
  evidence: Record<string, unknown>;
  openedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

// ─── Pure Function Input Types ────────────────────────────────────────────────

export interface CryptoCollateralValueInput {
  pledgedUnits: number;
  referencePriceUsd: number | null;
  haircutPercent: number | null;
  eligibleAdvanceRate: number | null;
}

export interface CryptoLtvInput {
  securedExposureUsd: number | null;
  collateralValueUsd: number | null;
}

export interface CryptoThresholdStateInput {
  currentLtv: number | null;
  warningLtvThreshold: number;
  marginCallLtvThreshold: number;
  liquidationLtvThreshold: number;
}

export type CryptoThresholdState =
  | "healthy"
  | "warning"
  | "margin_call"
  | "liquidation_review"
  | "unknown";

export interface CryptoMonitoringCadenceInput {
  currentLtv: number | null;
  warningLtvThreshold: number;
  marginCallLtvThreshold: number;
  liquidationLtvThreshold: number;
  valuationStatus: CryptoValuationStatus;
  collateralValueUsd: number | null;
}

export interface CryptoReasonCodesInput {
  positions: CryptoCollateralPosition[];
  openMarginEvents: CryptoMarginEvent[];
  monitoringProgram: CryptoMonitoringProgram | null;
  nowIso: string;
}

export interface CryptoRelationshipStatusInput {
  reasonCodes: CryptoReasonEntry[];
  openMarginEvents: CryptoMarginEvent[];
  activeCases: CryptoProtectionCase[];
  activePositionCount: number;
}

export interface CryptoCollateralHealthInput {
  positions: CryptoCollateralPosition[];
}

export interface CryptoProtectionReadinessInput {
  openMarginEvents: CryptoMarginEvent[];
  activeCases: CryptoProtectionCase[];
}

export interface CryptoNextActionsInput {
  positions: CryptoCollateralPosition[];
  openMarginEvents: CryptoMarginEvent[];
  activeCases: CryptoProtectionCase[];
  reasonCodes: CryptoReasonEntry[];
  monitoringProgram: CryptoMonitoringProgram | null;
}

export interface RelationshipNextAction {
  actionCode: CryptoActionCode;
  label: string;
  priority: number;
  targetType: "position" | "margin_event" | "case" | "monitoring";
  targetId: string | null;
  evidence: Record<string, unknown>;
}

// ─── Canonical Crypto Pack ────────────────────────────────────────────────────

export interface RelationshipCryptoPack {
  cryptoRelationshipStatus: CryptoRelationshipStatus;
  cryptoCollateralHealth: CryptoCollateralHealth;
  cryptoValuationStatus: CryptoValuationStatus;
  cryptoCustodyStatus: CryptoCustodyStatus;
  liquidationApprovalStatus: LiquidationApprovalStatus;

  activeCryptoPositionCount: number;
  activeMarginCallCount: number;
  activeCryptoProtectionCaseCount: number;

  currentWeightedLtv: number | null;
  nearestWarningThreshold: number | null;
  nearestMarginCallThreshold: number | null;
  nearestLiquidationThreshold: number | null;

  triggerMonitoringCadence: CryptoMonitoringCadence;

  cryptoProtectionReadiness: CryptoProtectionReadiness;
  openCryptoReasonCodes: CryptoReasonEntry[];

  nextActions: RelationshipNextAction[];
  blockers: CryptoBlocker[];
  explanations: string[];
}
