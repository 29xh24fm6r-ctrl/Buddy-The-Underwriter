// Pure function. No DB. No side effects. No network.
import type {
  CryptoReasonCodesInput,
  CryptoReasonEntry,
} from "./cryptoTypes";

const STALE_VALUATION_HOURS = 24;
const CURE_EXPIRY_WARNING_HOURS = 24;

/**
 * Produce structured crypto reason codes with evidence.
 * Evaluates all positions, margin events, and monitoring state.
 */
export function deriveCryptoReasonCodes(
  input: CryptoReasonCodesInput,
): CryptoReasonEntry[] {
  const reasons: CryptoReasonEntry[] = [];
  const now = new Date(input.nowIso).getTime();

  // Per-position checks
  for (const pos of input.positions) {
    if (pos.positionStatus !== "active") continue;

    // Valuation stale
    if (pos.valuationStatus === "stale" || pos.valuationStatus === "unavailable") {
      reasons.push({
        code: "valuation_stale",
        severity: pos.valuationStatus === "unavailable" ? "high" : "medium",
        evidence: { positionId: pos.id, assetSymbol: pos.assetSymbol, valuationStatus: pos.valuationStatus },
      });
    }

    // Custody unverified
    if (pos.custodyStatus === "unverified" || pos.custodyStatus === "control_issue") {
      reasons.push({
        code: "custody_unverified",
        severity: pos.custodyStatus === "control_issue" ? "high" : "medium",
        evidence: { positionId: pos.id, custodyStatus: pos.custodyStatus },
      });
    }

    // Threshold breaches
    if (pos.currentLtv != null) {
      if (pos.currentLtv >= pos.liquidationLtvThreshold) {
        reasons.push({
          code: "liquidation_threshold_breached",
          severity: "critical",
          evidence: { positionId: pos.id, currentLtv: pos.currentLtv, threshold: pos.liquidationLtvThreshold },
        });
      } else if (pos.currentLtv >= pos.marginCallLtvThreshold) {
        reasons.push({
          code: "margin_call_threshold_breached",
          severity: "high",
          evidence: { positionId: pos.id, currentLtv: pos.currentLtv, threshold: pos.marginCallLtvThreshold },
        });
      } else if (pos.currentLtv >= pos.warningLtvThreshold) {
        reasons.push({
          code: "warning_threshold_breached",
          severity: "medium",
          evidence: { positionId: pos.id, currentLtv: pos.currentLtv, threshold: pos.warningLtvThreshold },
        });
      }
    }
  }

  // Margin event checks
  for (const evt of input.openMarginEvents) {
    if (evt.status === "resolved" || evt.status === "cancelled") continue;

    // Cure period open
    if (evt.eventType === "cure_started" && evt.cureDueAt) {
      const dueAt = new Date(evt.cureDueAt).getTime();
      const hoursRemaining = (dueAt - now) / (1000 * 60 * 60);

      if (hoursRemaining <= 0) {
        reasons.push({
          code: "cure_period_expired",
          severity: "critical",
          evidence: { marginEventId: evt.id, cureDueAt: evt.cureDueAt },
        });
      } else {
        reasons.push({
          code: "cure_period_open",
          severity: hoursRemaining < CURE_EXPIRY_WARNING_HOURS ? "high" : "medium",
          evidence: { marginEventId: evt.id, cureDueAt: evt.cureDueAt, hoursRemaining },
        });
      }
    }
  }

  // LTV deteriorating — check if multiple positions have high LTV
  const activeLtvPositions = input.positions.filter(
    (p) => p.positionStatus === "active" && p.currentLtv != null,
  );
  const deterioratingCount = activeLtvPositions.filter(
    (p) => p.currentLtv! >= p.warningLtvThreshold,
  ).length;
  if (deterioratingCount > 1) {
    reasons.push({
      code: "ltv_deteriorating",
      severity: "high",
      evidence: { deterioratingPositionCount: deterioratingCount },
    });
  }

  // Monitoring stalled
  if (input.monitoringProgram) {
    const mp = input.monitoringProgram;
    if (mp.status === "paused") {
      reasons.push({
        code: "crypto_monitoring_stalled",
        severity: "medium",
        evidence: { monitoringProgramId: mp.id, status: mp.status },
      });
    } else if (mp.lastEvaluatedAt) {
      const lastEval = new Date(mp.lastEvaluatedAt).getTime();
      const hoursSinceEval = (now - lastEval) / (1000 * 60 * 60);
      if (hoursSinceEval > STALE_VALUATION_HOURS) {
        reasons.push({
          code: "crypto_monitoring_stalled",
          severity: "medium",
          evidence: { monitoringProgramId: mp.id, hoursSinceLastEval: hoursSinceEval },
        });
      }
    }
  }

  return reasons;
}
