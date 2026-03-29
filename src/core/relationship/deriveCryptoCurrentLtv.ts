// Pure function. No DB. No side effects. No network.
import type { CryptoLtvInput } from "./cryptoTypes";

/**
 * Compute current LTV from secured exposure and collateral value.
 * Returns null when either input is missing or collateral is zero.
 */
export function deriveCryptoCurrentLtv(input: CryptoLtvInput): number | null {
  if (
    input.securedExposureUsd == null ||
    input.collateralValueUsd == null ||
    input.collateralValueUsd <= 0
  ) {
    return null;
  }

  return input.securedExposureUsd / input.collateralValueUsd;
}
