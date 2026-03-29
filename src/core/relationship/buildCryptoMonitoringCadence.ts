// Pure function. No DB. No side effects. No network.
import type { CryptoMonitoringCadenceInput, CryptoMonitoringCadence } from "./cryptoTypes";

/**
 * Tighten evaluation cadence as LTV approaches risk thresholds.
 *
 * Rules:
 * - insufficient evidence => manual
 * - far from warning => daily
 * - near warning => 12h
 * - near margin call => 6h or 1h
 * - near liquidation => 15m
 */
export function buildCryptoMonitoringCadence(
  input: CryptoMonitoringCadenceInput,
): CryptoMonitoringCadence {
  // Cannot determine cadence without price or collateral evidence
  if (
    input.currentLtv == null ||
    input.valuationStatus === "unavailable" ||
    input.collateralValueUsd == null ||
    input.collateralValueUsd <= 0
  ) {
    return "manual";
  }

  // Liquidation zone
  if (input.currentLtv >= input.liquidationLtvThreshold) return "15m";

  // Margin call zone — how close to liquidation?
  if (input.currentLtv >= input.marginCallLtvThreshold) {
    const distToLiquidation = input.liquidationLtvThreshold - input.currentLtv;
    return distToLiquidation < 0.05 ? "15m" : "1h";
  }

  // Warning zone — how close to margin call?
  if (input.currentLtv >= input.warningLtvThreshold) {
    const distToMarginCall = input.marginCallLtvThreshold - input.currentLtv;
    return distToMarginCall < 0.05 ? "1h" : "6h";
  }

  // Healthy zone — how close to warning?
  const distToWarning = input.warningLtvThreshold - input.currentLtv;
  if (distToWarning < 0.10) return "12h";

  return "daily";
}
