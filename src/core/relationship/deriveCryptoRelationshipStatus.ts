// Pure function. No DB. No side effects. No network.
import type {
  CryptoRelationshipStatusInput,
  CryptoRelationshipStatus,
} from "./cryptoTypes";

/**
 * Collapse reason codes + open margin events + cases into canonical crypto relationship status.
 * Priority order: most severe wins.
 */
export function deriveCryptoRelationshipStatus(
  input: CryptoRelationshipStatusInput,
): CryptoRelationshipStatus {
  // No active positions => not applicable
  if (input.activePositionCount === 0) return "not_applicable";

  // Check for liquidation review
  const hasLiquidationReview = input.openMarginEvents.some(
    (e) =>
      e.eventType === "liquidation_review_opened" &&
      e.status !== "resolved" &&
      e.status !== "cancelled",
  );
  if (hasLiquidationReview) return "liquidation_review_required";

  // Check for stalled cases
  const hasStalledCase = input.activeCases.some(
    (c) => c.status === "stalled",
  );
  if (hasStalledCase) return "stalled";

  // Check for open margin call
  const hasMarginCall = input.openMarginEvents.some(
    (e) =>
      e.eventType === "margin_call_opened" &&
      (e.status === "open" || e.status === "in_progress"),
  );
  if (hasMarginCall) return "margin_call_open";

  // Check for cure pending (cure explicitly started)
  const hasCurePending = input.openMarginEvents.some(
    (e) =>
      e.eventType === "cure_started" &&
      e.status !== "resolved" &&
      e.status !== "cancelled",
  );
  if (hasCurePending) return "cure_pending";

  // Check for warning
  const hasWarning = input.reasonCodes.some(
    (r) => r.code === "warning_threshold_breached",
  );
  if (hasWarning) return "warning";

  // Check for any critical/high reason codes that indicate unresolved state
  const hasHighSeverity = input.reasonCodes.some(
    (r) => r.severity === "critical" || r.severity === "high",
  );
  if (hasHighSeverity) return "warning";

  // Has resolved events and no active issues
  const hasResolvedEvents = input.openMarginEvents.some(
    (e) => e.status === "resolved",
  );
  if (hasResolvedEvents && !hasWarning && !hasMarginCall) return "resolved";

  return "monitored";
}
