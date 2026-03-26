/**
 * Phase 55E — Banker Override Intelligence
 *
 * Analyzes banker overrides for directionality, materiality,
 * and committee disclosure requirements.
 *
 * Pure function — no DB calls.
 */

import type { OverrideInsight } from "./exception-types";
import { categorizeFactKey, isDecisionCriticalCategory } from "./scoreFinancialException";

type ResolutionInput = {
  factKey: string;
  periodKey: string | null;
  action: string;
  priorValue: number | null;
  resolvedValue: number | null;
  rationale: string | null;
};

const MATERIALITY_THRESHOLD_PCT = 10; // 10% delta is material

/**
 * Build override insights from resolution audit data.
 */
export function buildOverrideInsights(resolutions: ResolutionInput[]): OverrideInsight[] {
  return resolutions
    .filter((r) => r.action === "override_value" || r.action === "provide_value")
    .map((r) => {
      const buddyValue = r.priorValue;
      const bankerValue = r.resolvedValue;

      const delta = (buddyValue != null && bankerValue != null) ? bankerValue - buddyValue : null;
      const deltaPct = (buddyValue != null && buddyValue !== 0 && delta != null)
        ? Math.round((delta / Math.abs(buddyValue)) * 10000) / 100
        : null;

      const direction = computeDirection(r.factKey, delta);
      const material = deltaPct != null ? Math.abs(deltaPct) >= MATERIALITY_THRESHOLD_PCT : (r.action === "provide_value");

      const rationaleQuality = assessRationaleQuality(r.rationale);

      const category = categorizeFactKey(r.factKey);
      const isCritical = isDecisionCriticalCategory(category);
      const requiresDisclosure = material && (isCritical || rationaleQuality === "weak");

      return {
        factKey: r.factKey,
        periodKey: r.periodKey,
        buddyValue,
        bankerValue,
        delta,
        deltaPct,
        direction,
        material,
        rationaleQuality,
        requiresCommitteeDisclosure: requiresDisclosure,
      };
    });
}

function computeDirection(
  factKey: string,
  delta: number | null,
): OverrideInsight["direction"] {
  if (delta == null) return "unknown";
  if (Math.abs(delta) < 0.01) return "neutral";

  // For income/coverage metrics, higher is more favorable (conservative means lower)
  const incomeKeys = new Set(["revenue", "ebitda", "net_income", "noi", "dscr", "global_dscr", "cash_flow"]);
  const debtKeys = new Set(["total_debt", "funded_debt", "total_liabilities", "ltv"]);

  const lower = factKey.toLowerCase().replace(/[^a-z_]/g, "");

  if (incomeKeys.has(lower)) {
    return delta < 0 ? "conservative" : "aggressive";
  }
  if (debtKeys.has(lower)) {
    return delta > 0 ? "conservative" : "aggressive";
  }

  return delta > 0 ? "aggressive" : "conservative";
}

function assessRationaleQuality(rationale: string | null): OverrideInsight["rationaleQuality"] {
  if (!rationale) return "weak";
  const len = rationale.trim().length;
  if (len >= 50) return "strong";
  if (len >= 15) return "adequate";
  return "weak";
}
