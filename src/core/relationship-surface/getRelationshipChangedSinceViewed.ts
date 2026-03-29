// Pure function. No DB. No side effects. No network.
import type { ChangedSinceViewedInput, RelationshipSurfacePriorityBucket } from "./types";

const BUCKET_SEVERITY: Record<RelationshipSurfacePriorityBucket, number> = {
  healthy: 0,
  watch: 1,
  urgent: 2,
  critical: 3,
};

/**
 * Determine if a relationship surface item has changed since the banker last viewed it.
 * Acknowledgement never suppresses urgency — it only clears the "changed" flag until the next change.
 */
export function getRelationshipChangedSinceViewed(
  input: ChangedSinceViewedInput,
): boolean {
  // No prior acknowledgement => always changed
  if (!input.lastAcknowledgedAt) return true;

  const ackTime = new Date(input.lastAcknowledgedAt).getTime();

  // Primary reason code changed
  if (
    input.lastAcknowledgedReasonCode != null &&
    input.currentPrimaryReasonCode !== input.lastAcknowledgedReasonCode
  ) {
    return true;
  }

  // Priority bucket increased (more severe)
  if (
    input.previousPriorityBucket != null &&
    BUCKET_SEVERITY[input.currentPriorityBucket] >
      BUCKET_SEVERITY[input.previousPriorityBucket]
  ) {
    return true;
  }

  // New borrower activity after acknowledgement
  if (
    input.latestBorrowerActivityAt &&
    new Date(input.latestBorrowerActivityAt).getTime() > ackTime
  ) {
    return true;
  }

  // Auto-progress occurred after acknowledgement
  if (
    input.latestAutoProgressAt &&
    new Date(input.latestAutoProgressAt).getTime() > ackTime
  ) {
    return true;
  }

  // New case opened after acknowledgement
  if (
    input.latestCaseOpenedAt &&
    new Date(input.latestCaseOpenedAt).getTime() > ackTime
  ) {
    return true;
  }

  // New critical event after acknowledgement
  if (
    input.latestCriticalEventAt &&
    new Date(input.latestCriticalEventAt).getTime() > ackTime
  ) {
    return true;
  }

  // New crypto distress event after acknowledgement
  if (
    input.latestCryptoDistressAt &&
    new Date(input.latestCryptoDistressAt).getTime() > ackTime
  ) {
    return true;
  }

  return false;
}
