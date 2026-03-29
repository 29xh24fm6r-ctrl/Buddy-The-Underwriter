// Pure function. No DB. No side effects. No network.
import type { CryptoThresholdStateInput, CryptoThresholdState } from "./cryptoTypes";

/**
 * Determine whether position is healthy, warning, margin-call, or liquidation-review territory.
 * LTV thresholds are checked from most severe to least severe.
 */
export function deriveCryptoThresholdState(
  input: CryptoThresholdStateInput,
): CryptoThresholdState {
  if (input.currentLtv == null) return "unknown";

  // Higher LTV = more danger (exposure exceeds collateral)
  if (input.currentLtv >= input.liquidationLtvThreshold) return "liquidation_review";
  if (input.currentLtv >= input.marginCallLtvThreshold) return "margin_call";
  if (input.currentLtv >= input.warningLtvThreshold) return "warning";

  return "healthy";
}
