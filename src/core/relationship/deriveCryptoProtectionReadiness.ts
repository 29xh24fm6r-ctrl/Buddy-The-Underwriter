// Pure function. No DB. No side effects. No network.
import type {
  CryptoProtectionReadinessInput,
  CryptoProtectionReadiness,
} from "./cryptoTypes";

/**
 * Collapse opportunity/event/case state into relationship-level readiness.
 */
export function deriveCryptoProtectionReadiness(
  input: CryptoProtectionReadinessInput,
): CryptoProtectionReadiness {
  const openEvents = input.openMarginEvents.filter(
    (e) => e.status !== "resolved" && e.status !== "cancelled",
  );
  const activeCases = input.activeCases.filter(
    (c) => c.closedAt == null,
  );

  // No events or cases => not applicable
  if (openEvents.length === 0 && activeCases.length === 0) {
    return "not_applicable";
  }

  // Check for stalled case
  if (activeCases.some((c) => c.status === "stalled")) {
    return "stalled";
  }

  // Check for active case
  if (activeCases.some((c) => c.status !== "resolved" && c.status !== "closed")) {
    return "active_case_open";
  }

  // Check if all resolved
  if (
    activeCases.length > 0 &&
    activeCases.every((c) => c.status === "resolved" || c.status === "closed")
  ) {
    return "resolved";
  }

  // Events open but no case yet => review required
  if (openEvents.length > 0 && activeCases.length === 0) {
    return "review_required";
  }

  return "ready";
}
