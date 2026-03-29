// Pure function. No DB. No side effects. No network.
import type {
  CryptoReasonEntry,
  CryptoRelationshipStatus,
  CryptoCollateralHealth,
  CryptoMonitoringCadence,
  RelationshipNextAction,
} from "./cryptoTypes";

/**
 * Build human-readable explanations for canonical response, queue details, and timeline summaries.
 * Returns 1–5 explanations.
 */
export function buildCryptoExplanations(input: {
  cryptoRelationshipStatus: CryptoRelationshipStatus;
  cryptoCollateralHealth: CryptoCollateralHealth;
  activeCryptoPositionCount: number;
  activeMarginCallCount: number;
  triggerMonitoringCadence: CryptoMonitoringCadence;
  currentWeightedLtv: number | null;
  reasonCodes: CryptoReasonEntry[];
  nextActions: RelationshipNextAction[];
}): string[] {
  const explanations: string[] = [];

  if (input.activeCryptoPositionCount === 0) {
    return ["No active crypto collateral positions for this relationship."];
  }

  // Status explanation
  const statusExplanations: Record<CryptoRelationshipStatus, string> = {
    not_applicable: "Crypto collateral is not applicable for this relationship.",
    monitored: "Crypto collateral is being monitored. All positions within safe thresholds.",
    warning: "One or more crypto positions are approaching warning thresholds.",
    margin_call_open: "An active margin call is open. Immediate attention required.",
    cure_pending: "A cure period is in progress following a margin call.",
    liquidation_review_required: "Liquidation review is required. Banker approval needed before any action.",
    resolved: "Previous crypto distress has been resolved. Positions are stable.",
    stalled: "A crypto protection case is stalled. Investigation needed.",
  };
  explanations.push(statusExplanations[input.cryptoRelationshipStatus]);

  // Health explanation
  if (input.cryptoCollateralHealth === "critical") {
    explanations.push(
      "Crypto collateral health is critical. One or more positions have breached liquidation thresholds.",
    );
  } else if (input.cryptoCollateralHealth === "stressed") {
    explanations.push(
      "Crypto collateral is under stress. Margin call thresholds have been breached.",
    );
  } else if (input.cryptoCollateralHealth === "pressured") {
    explanations.push(
      "Crypto collateral is under pressure. Warning thresholds have been breached.",
    );
  }

  // LTV context
  if (input.currentWeightedLtv != null) {
    explanations.push(
      `Current weighted LTV: ${(input.currentWeightedLtv * 100).toFixed(1)}%. Monitoring cadence: ${input.triggerMonitoringCadence}.`,
    );
  }

  // Margin call context
  if (input.activeMarginCallCount > 0) {
    explanations.push(
      `${input.activeMarginCallCount} active margin call${input.activeMarginCallCount > 1 ? "s" : ""} require attention.`,
    );
  }

  // Critical reason codes
  const criticalReasons = input.reasonCodes.filter(
    (r) => r.severity === "critical",
  );
  for (const r of criticalReasons.slice(0, 2)) {
    const labels: Record<string, string> = {
      liquidation_threshold_breached: "Liquidation threshold breached.",
      cure_period_expired: "Cure period has expired.",
    };
    if (labels[r.code]) {
      explanations.push(labels[r.code]);
    }
  }

  return explanations.slice(0, 5);
}
