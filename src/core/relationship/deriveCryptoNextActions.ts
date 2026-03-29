// Pure function. No DB. No side effects. No network.
import type {
  CryptoNextActionsInput,
  RelationshipNextAction,
} from "./cryptoTypes";

/**
 * Map crypto facts into governed next actions.
 * Priority: lower number = higher priority.
 * Max 5 actions returned, sorted by priority ascending.
 */
export function deriveCryptoNextActions(
  input: CryptoNextActionsInput,
): RelationshipNextAction[] {
  const actions: RelationshipNextAction[] = [];

  // 1. Liquidation review (highest priority crypto action)
  for (const evt of input.openMarginEvents) {
    if (
      evt.eventType === "liquidation_review_opened" &&
      evt.status !== "resolved" &&
      evt.status !== "cancelled"
    ) {
      if (evt.approvalStatus === "review_required") {
        actions.push({
          actionCode: "approve_liquidation",
          label: "Approve or decline liquidation",
          priority: 10,
          targetType: "margin_event",
          targetId: evt.id,
          evidence: { ltvAtEvent: evt.ltvAtEvent, threshold: evt.thresholdAtEvent },
        });
      } else {
        actions.push({
          actionCode: "review_liquidation_request",
          label: "Review liquidation request",
          priority: 15,
          targetType: "margin_event",
          targetId: evt.id,
          evidence: { ltvAtEvent: evt.ltvAtEvent },
        });
      }
    }
  }

  // 2. Cure advancement
  for (const evt of input.openMarginEvents) {
    if (
      (evt.eventType === "cure_started" || evt.eventType === "margin_call_opened") &&
      evt.status !== "resolved" &&
      evt.status !== "cancelled"
    ) {
      actions.push({
        actionCode: "advance_crypto_cure",
        label: "Advance cure for margin call",
        priority: 20,
        targetType: "margin_event",
        targetId: evt.id,
        evidence: { cureDueAt: evt.cureDueAt, eventType: evt.eventType },
      });
    }
  }

  // 3. Open margin call (threshold breached, no event yet)
  for (const pos of input.positions) {
    if (pos.positionStatus !== "active") continue;
    if (
      pos.currentLtv != null &&
      pos.currentLtv >= pos.marginCallLtvThreshold
    ) {
      const hasOpenMarginCall = input.openMarginEvents.some(
        (e) =>
          e.collateralPositionId === pos.id &&
          (e.eventType === "margin_call_opened" ||
            e.eventType === "liquidation_review_opened") &&
          e.status !== "resolved" &&
          e.status !== "cancelled",
      );
      if (!hasOpenMarginCall) {
        actions.push({
          actionCode: "open_margin_call",
          label: `Open margin call for ${pos.assetSymbol}`,
          priority: 25,
          targetType: "position",
          targetId: pos.id,
          evidence: { currentLtv: pos.currentLtv, threshold: pos.marginCallLtvThreshold },
        });
      }
    }
  }

  // 4. Custody verification
  for (const pos of input.positions) {
    if (pos.positionStatus !== "active") continue;
    if (
      pos.custodyStatus === "unverified" ||
      pos.custodyStatus === "control_issue"
    ) {
      actions.push({
        actionCode: "verify_custody_control",
        label: `Verify custody for ${pos.assetSymbol}`,
        priority: 30,
        targetType: "position",
        targetId: pos.id,
        evidence: { custodyStatus: pos.custodyStatus, custodyProvider: pos.custodyProvider },
      });
    }
  }

  // 5. Valuation refresh
  for (const pos of input.positions) {
    if (pos.positionStatus !== "active") continue;
    if (
      pos.valuationStatus === "stale" ||
      pos.valuationStatus === "unavailable"
    ) {
      actions.push({
        actionCode: "refresh_crypto_valuation",
        label: `Refresh valuation for ${pos.assetSymbol}`,
        priority: 35,
        targetType: "position",
        targetId: pos.id,
        evidence: { valuationStatus: pos.valuationStatus },
      });
    }
  }

  // 6. Resolve distress (cases near resolution)
  for (const c of input.activeCases) {
    if (c.closedAt != null) continue;
    if (c.status === "resolved" || c.status === "ready") {
      actions.push({
        actionCode: "resolve_crypto_distress",
        label: "Resolve crypto distress case",
        priority: 40,
        targetType: "case",
        targetId: c.id,
        evidence: { caseStatus: c.status },
      });
    }
  }

  // 7. General review (no specific issues, positions exist)
  if (
    actions.length === 0 &&
    input.positions.some((p) => p.positionStatus === "active")
  ) {
    actions.push({
      actionCode: "review_crypto_collateral",
      label: "Review crypto collateral positions",
      priority: 50,
      targetType: "monitoring",
      targetId: input.monitoringProgram?.id ?? null,
      evidence: { activePositionCount: input.positions.filter((p) => p.positionStatus === "active").length },
    });
  }

  // Sort by priority, cap at 5
  actions.sort((a, b) => a.priority - b.priority);
  return actions.slice(0, 5);
}
