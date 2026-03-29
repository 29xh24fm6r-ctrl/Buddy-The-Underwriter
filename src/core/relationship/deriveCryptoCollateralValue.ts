// Pure function. No DB. No side effects. No network.
import type { CryptoCollateralValueInput } from "./cryptoTypes";

/**
 * Compute collateral value from pledged units, price snapshot, haircut, and eligibility.
 * Returns null values when inputs are insufficient.
 */
export function deriveCryptoCollateralValue(input: CryptoCollateralValueInput): {
  marketValueUsd: number | null;
  collateralValueUsd: number | null;
} {
  if (input.referencePriceUsd == null || input.referencePriceUsd <= 0) {
    return { marketValueUsd: null, collateralValueUsd: null };
  }

  const marketValueUsd = input.pledgedUnits * input.referencePriceUsd;

  // Apply haircut if present (haircut reduces value)
  const afterHaircut =
    input.haircutPercent != null && input.haircutPercent > 0
      ? marketValueUsd * (1 - input.haircutPercent)
      : marketValueUsd;

  // Apply eligible advance rate if present (further restricts recognized value)
  const collateralValueUsd =
    input.eligibleAdvanceRate != null && input.eligibleAdvanceRate > 0
      ? afterHaircut * input.eligibleAdvanceRate
      : afterHaircut;

  return { marketValueUsd, collateralValueUsd };
}
