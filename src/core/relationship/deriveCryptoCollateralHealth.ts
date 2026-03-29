// Pure function. No DB. No side effects. No network.
import type { CryptoCollateralHealthInput, CryptoCollateralHealth } from "./cryptoTypes";

/**
 * Collapse current crypto condition into healthy / pressured / stressed / critical.
 * Evaluates all active positions and picks the worst state.
 */
export function deriveCryptoCollateralHealth(
  input: CryptoCollateralHealthInput,
): CryptoCollateralHealth {
  const activePositions = input.positions.filter(
    (p) => p.positionStatus === "active",
  );

  if (activePositions.length === 0) return "unknown";

  let worstHealth: CryptoCollateralHealth = "healthy";

  for (const pos of activePositions) {
    if (pos.currentLtv == null || pos.valuationStatus === "unavailable") {
      worstHealth = pickWorse(worstHealth, "unknown");
      continue;
    }

    if (pos.currentLtv >= pos.liquidationLtvThreshold) {
      return "critical"; // immediate worst case
    }

    if (pos.currentLtv >= pos.marginCallLtvThreshold) {
      worstHealth = pickWorse(worstHealth, "stressed");
    } else if (pos.currentLtv >= pos.warningLtvThreshold) {
      worstHealth = pickWorse(worstHealth, "pressured");
    }
  }

  return worstHealth;
}

const SEVERITY_ORDER: Record<CryptoCollateralHealth, number> = {
  healthy: 0,
  unknown: 1,
  pressured: 2,
  stressed: 3,
  critical: 4,
};

function pickWorse(
  a: CryptoCollateralHealth,
  b: CryptoCollateralHealth,
): CryptoCollateralHealth {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}
