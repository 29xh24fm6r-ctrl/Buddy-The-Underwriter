import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveCryptoCollateralValue } from "../deriveCryptoCollateralValue";
import { deriveCryptoCurrentLtv } from "../deriveCryptoCurrentLtv";
import { deriveCryptoThresholdState } from "../deriveCryptoThresholdState";
import { buildCryptoMonitoringCadence } from "../buildCryptoMonitoringCadence";
import { deriveCryptoReasonCodes } from "../deriveCryptoReasonCodes";
import { deriveCryptoRelationshipStatus } from "../deriveCryptoRelationshipStatus";
import { deriveCryptoCollateralHealth } from "../deriveCryptoCollateralHealth";
import { deriveCryptoProtectionReadiness } from "../deriveCryptoProtectionReadiness";
import { deriveCryptoNextActions } from "../deriveCryptoNextActions";
import { buildCryptoExplanations } from "../buildCryptoExplanations";
import type {
  CryptoCollateralPosition,
  CryptoMarginEvent,
  CryptoMonitoringProgram,
  CryptoProtectionCase,
} from "../cryptoTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePosition(overrides: Partial<CryptoCollateralPosition> = {}): CryptoCollateralPosition {
  return {
    id: "pos-1",
    relationshipId: "rel-1",
    bankId: "bank-1",
    dealId: null,
    assetSymbol: "BTC",
    custodyProvider: "Fireblocks",
    custodyAccountRef: "acc-1",
    pledgedUnits: 10,
    eligibleAdvanceRate: null,
    haircutPercent: 0.20,
    marketValueUsd: 500000,
    collateralValueUsd: 400000,
    securedExposureUsd: 300000,
    currentLtv: 0.75,
    warningLtvThreshold: 0.70,
    marginCallLtvThreshold: 0.80,
    liquidationLtvThreshold: 0.90,
    custodyStatus: "verified",
    valuationStatus: "current",
    positionStatus: "active",
    evidence: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMarginEvent(overrides: Partial<CryptoMarginEvent> = {}): CryptoMarginEvent {
  return {
    id: "evt-1",
    relationshipId: "rel-1",
    bankId: "bank-1",
    collateralPositionId: "pos-1",
    eventType: "margin_call_opened",
    status: "open",
    ltvAtEvent: 0.82,
    thresholdAtEvent: 0.80,
    cureDueAt: null,
    resolvedAt: null,
    borrowerPackageId: null,
    approvalRequired: false,
    approvalStatus: "not_applicable",
    evidence: {},
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeCase(overrides: Partial<CryptoProtectionCase> = {}): CryptoProtectionCase {
  return {
    id: "case-1",
    relationshipId: "rel-1",
    bankId: "bank-1",
    marginEventId: "evt-1",
    status: "open",
    ownerUserId: null,
    bankerReviewRequired: true,
    bankerReviewCompletedAt: null,
    bankerReviewCompletedBy: null,
    outcome: {},
    evidence: {},
    openedAt: "2026-01-01T00:00:00Z",
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

// ─── B. Valuation + LTV tests (11–20) ────────────────────────────────────────

describe("deriveCryptoCollateralValue", () => {
  it("11. derives market/collateral value correctly", () => {
    const result = deriveCryptoCollateralValue({
      pledgedUnits: 10,
      referencePriceUsd: 50000,
      haircutPercent: null,
      eligibleAdvanceRate: null,
    });
    assert.equal(result.marketValueUsd, 500000);
    assert.equal(result.collateralValueUsd, 500000);
  });

  it("12. applies haircut correctly", () => {
    const result = deriveCryptoCollateralValue({
      pledgedUnits: 10,
      referencePriceUsd: 50000,
      haircutPercent: 0.20,
      eligibleAdvanceRate: null,
    });
    assert.equal(result.marketValueUsd, 500000);
    assert.equal(result.collateralValueUsd, 400000);
  });

  it("13. returns null with missing price", () => {
    const result = deriveCryptoCollateralValue({
      pledgedUnits: 10,
      referencePriceUsd: null,
      haircutPercent: 0.20,
      eligibleAdvanceRate: null,
    });
    assert.equal(result.marketValueUsd, null);
    assert.equal(result.collateralValueUsd, null);
  });
});

describe("deriveCryptoCurrentLtv", () => {
  it("returns null with missing collateral value", () => {
    assert.equal(deriveCryptoCurrentLtv({ securedExposureUsd: 300000, collateralValueUsd: null }), null);
  });

  it("returns null with zero collateral", () => {
    assert.equal(deriveCryptoCurrentLtv({ securedExposureUsd: 300000, collateralValueUsd: 0 }), null);
  });

  it("computes correct LTV", () => {
    assert.equal(deriveCryptoCurrentLtv({ securedExposureUsd: 300000, collateralValueUsd: 400000 }), 0.75);
  });
});

describe("deriveCryptoThresholdState", () => {
  const base = {
    warningLtvThreshold: 0.70,
    marginCallLtvThreshold: 0.80,
    liquidationLtvThreshold: 0.90,
  };

  it("14. derives healthy", () => {
    assert.equal(deriveCryptoThresholdState({ ...base, currentLtv: 0.50 }), "healthy");
  });

  it("15. derives warning", () => {
    assert.equal(deriveCryptoThresholdState({ ...base, currentLtv: 0.75 }), "warning");
  });

  it("16. derives margin_call", () => {
    assert.equal(deriveCryptoThresholdState({ ...base, currentLtv: 0.85 }), "margin_call");
  });

  it("17. derives liquidation_review", () => {
    assert.equal(deriveCryptoThresholdState({ ...base, currentLtv: 0.95 }), "liquidation_review");
  });

  it("returns unknown for null LTV", () => {
    assert.equal(deriveCryptoThresholdState({ ...base, currentLtv: null }), "unknown");
  });
});

describe("buildCryptoMonitoringCadence", () => {
  const base = {
    warningLtvThreshold: 0.70,
    marginCallLtvThreshold: 0.80,
    liquidationLtvThreshold: 0.90,
    valuationStatus: "current" as const,
    collateralValueUsd: 400000,
  };

  it("18. daily when safe", () => {
    assert.equal(buildCryptoMonitoringCadence({ ...base, currentLtv: 0.40 }), "daily");
  });

  it("19. tightens near thresholds", () => {
    const nearWarning = buildCryptoMonitoringCadence({ ...base, currentLtv: 0.65 });
    assert.equal(nearWarning, "12h");
    const inMarginCall = buildCryptoMonitoringCadence({ ...base, currentLtv: 0.85 });
    assert.equal(inMarginCall, "1h");
  });

  it("20. deterministic for same input", () => {
    const r1 = buildCryptoMonitoringCadence({ ...base, currentLtv: 0.72 });
    const r2 = buildCryptoMonitoringCadence({ ...base, currentLtv: 0.72 });
    assert.equal(r1, r2);
  });

  it("manual when valuation unavailable", () => {
    assert.equal(
      buildCryptoMonitoringCadence({ ...base, currentLtv: 0.50, valuationStatus: "unavailable" }),
      "manual",
    );
  });
});

// ─── C. Reason code tests (21–30) ────────────────────────────────────────────

describe("deriveCryptoReasonCodes", () => {
  const nowIso = "2026-03-29T12:00:00Z";

  it("21. detects valuation stale", () => {
    const pos = makePosition({ valuationStatus: "stale" });
    const codes = deriveCryptoReasonCodes({ positions: [pos], openMarginEvents: [], monitoringProgram: null, nowIso });
    assert.ok(codes.some((c) => c.code === "valuation_stale"));
  });

  it("22. detects custody unverified", () => {
    const pos = makePosition({ custodyStatus: "unverified" });
    const codes = deriveCryptoReasonCodes({ positions: [pos], openMarginEvents: [], monitoringProgram: null, nowIso });
    assert.ok(codes.some((c) => c.code === "custody_unverified"));
  });

  it("23. detects warning threshold breached", () => {
    const pos = makePosition({ currentLtv: 0.75 });
    const codes = deriveCryptoReasonCodes({ positions: [pos], openMarginEvents: [], monitoringProgram: null, nowIso });
    assert.ok(codes.some((c) => c.code === "warning_threshold_breached"));
  });

  it("24. detects margin-call threshold breached", () => {
    const pos = makePosition({ currentLtv: 0.85 });
    const codes = deriveCryptoReasonCodes({ positions: [pos], openMarginEvents: [], monitoringProgram: null, nowIso });
    assert.ok(codes.some((c) => c.code === "margin_call_threshold_breached"));
  });

  it("25. detects liquidation threshold breached", () => {
    const pos = makePosition({ currentLtv: 0.95 });
    const codes = deriveCryptoReasonCodes({ positions: [pos], openMarginEvents: [], monitoringProgram: null, nowIso });
    assert.ok(codes.some((c) => c.code === "liquidation_threshold_breached"));
  });

  it("26. detects cure period open", () => {
    const evt = makeMarginEvent({
      eventType: "cure_started",
      cureDueAt: "2026-04-01T00:00:00Z",
    });
    const codes = deriveCryptoReasonCodes({ positions: [], openMarginEvents: [evt], monitoringProgram: null, nowIso });
    assert.ok(codes.some((c) => c.code === "cure_period_open"));
  });

  it("27. detects cure period expired", () => {
    const evt = makeMarginEvent({
      eventType: "cure_started",
      cureDueAt: "2026-03-28T00:00:00Z",
    });
    const codes = deriveCryptoReasonCodes({ positions: [], openMarginEvents: [evt], monitoringProgram: null, nowIso });
    assert.ok(codes.some((c) => c.code === "cure_period_expired"));
  });

  it("28. detects ltv deteriorating (multiple stressed positions)", () => {
    const pos1 = makePosition({ id: "pos-1", currentLtv: 0.75 });
    const pos2 = makePosition({ id: "pos-2", currentLtv: 0.78, assetSymbol: "ETH" });
    const codes = deriveCryptoReasonCodes({ positions: [pos1, pos2], openMarginEvents: [], monitoringProgram: null, nowIso });
    assert.ok(codes.some((c) => c.code === "ltv_deteriorating"));
  });

  it("29. detects monitoring stalled", () => {
    const mp: CryptoMonitoringProgram = {
      id: "mp-1",
      relationshipId: "rel-1",
      bankId: "bank-1",
      status: "paused",
      cadence: "daily",
      triggerMode: "threshold_proximity",
      lastEvaluatedAt: null,
      nextEvaluateAt: null,
      config: {},
      evidence: {},
    };
    const codes = deriveCryptoReasonCodes({ positions: [], openMarginEvents: [], monitoringProgram: mp, nowIso });
    assert.ok(codes.some((c) => c.code === "crypto_monitoring_stalled"));
  });

  it("30. deterministic for same input", () => {
    const pos = makePosition({ currentLtv: 0.75 });
    const r1 = deriveCryptoReasonCodes({ positions: [pos], openMarginEvents: [], monitoringProgram: null, nowIso });
    const r2 = deriveCryptoReasonCodes({ positions: [pos], openMarginEvents: [], monitoringProgram: null, nowIso });
    assert.deepEqual(r1, r2);
  });
});

// ─── D. Status + health derivation (31–38) ───────────────────────────────────

describe("deriveCryptoRelationshipStatus", () => {
  it("31. not_applicable when no positions", () => {
    assert.equal(
      deriveCryptoRelationshipStatus({
        reasonCodes: [],
        openMarginEvents: [],
        activeCases: [],
        activePositionCount: 0,
      }),
      "not_applicable",
    );
  });

  it("32. monitored when healthy", () => {
    assert.equal(
      deriveCryptoRelationshipStatus({
        reasonCodes: [],
        openMarginEvents: [],
        activeCases: [],
        activePositionCount: 1,
      }),
      "monitored",
    );
  });

  it("33. warning on warning reason", () => {
    assert.equal(
      deriveCryptoRelationshipStatus({
        reasonCodes: [{ code: "warning_threshold_breached", severity: "medium", evidence: {} }],
        openMarginEvents: [],
        activeCases: [],
        activePositionCount: 1,
      }),
      "warning",
    );
  });

  it("34. margin_call_open on open margin call", () => {
    assert.equal(
      deriveCryptoRelationshipStatus({
        reasonCodes: [],
        openMarginEvents: [makeMarginEvent({ eventType: "margin_call_opened", status: "open" })],
        activeCases: [],
        activePositionCount: 1,
      }),
      "margin_call_open",
    );
  });

  it("35. cure_pending on cure started", () => {
    assert.equal(
      deriveCryptoRelationshipStatus({
        reasonCodes: [],
        openMarginEvents: [makeMarginEvent({ eventType: "cure_started", status: "in_progress" })],
        activeCases: [],
        activePositionCount: 1,
      }),
      "cure_pending",
    );
  });

  it("36. liquidation_review_required", () => {
    assert.equal(
      deriveCryptoRelationshipStatus({
        reasonCodes: [],
        openMarginEvents: [makeMarginEvent({ eventType: "liquidation_review_opened", status: "open" })],
        activeCases: [],
        activePositionCount: 1,
      }),
      "liquidation_review_required",
    );
  });

  it("37. resolved when all resolved", () => {
    assert.equal(
      deriveCryptoRelationshipStatus({
        reasonCodes: [],
        openMarginEvents: [makeMarginEvent({ status: "resolved" })],
        activeCases: [],
        activePositionCount: 1,
      }),
      "resolved",
    );
  });

  it("38. health collapse picks correct severity", () => {
    const healthy = deriveCryptoCollateralHealth({ positions: [makePosition({ currentLtv: 0.50 })] });
    assert.equal(healthy, "healthy");

    const critical = deriveCryptoCollateralHealth({ positions: [makePosition({ currentLtv: 0.95 })] });
    assert.equal(critical, "critical");

    const stressed = deriveCryptoCollateralHealth({ positions: [makePosition({ currentLtv: 0.85 })] });
    assert.equal(stressed, "stressed");
  });
});

// ─── E. Margin lifecycle (39–48) ─────────────────────────────────────────────

describe("deriveCryptoNextActions (margin lifecycle)", () => {
  it("39. opens warning action when threshold breached", () => {
    const pos = makePosition({ currentLtv: 0.75 });
    const actions = deriveCryptoNextActions({
      positions: [pos],
      openMarginEvents: [],
      activeCases: [],
      reasonCodes: [{ code: "warning_threshold_breached", severity: "medium", evidence: {} }],
      monitoringProgram: null,
    });
    assert.ok(actions.length > 0);
  });

  it("40. opens margin call action when needed", () => {
    const pos = makePosition({ currentLtv: 0.85 });
    const actions = deriveCryptoNextActions({
      positions: [pos],
      openMarginEvents: [],
      activeCases: [],
      reasonCodes: [],
      monitoringProgram: null,
    });
    assert.ok(actions.some((a) => a.actionCode === "open_margin_call"));
  });

  it("42. liquidation review action when threshold breached", () => {
    const actions = deriveCryptoNextActions({
      positions: [makePosition({ currentLtv: 0.95 })],
      openMarginEvents: [makeMarginEvent({ eventType: "liquidation_review_opened", approvalStatus: "review_required" })],
      activeCases: [],
      reasonCodes: [],
      monitoringProgram: null,
    });
    assert.ok(actions.some((a) => a.actionCode === "approve_liquidation"));
  });

  it("43. liquidation cannot auto-approve (requires banker action)", () => {
    const actions = deriveCryptoNextActions({
      positions: [makePosition({ currentLtv: 0.95 })],
      openMarginEvents: [makeMarginEvent({ eventType: "liquidation_review_opened", approvalStatus: "review_required" })],
      activeCases: [],
      reasonCodes: [],
      monitoringProgram: null,
    });
    // The action exists but it requires human interaction
    const approveAction = actions.find((a) => a.actionCode === "approve_liquidation");
    assert.ok(approveAction);
    assert.equal(approveAction!.targetType, "margin_event");
  });

  it("46. resolve action for ready cases", () => {
    const actions = deriveCryptoNextActions({
      positions: [makePosition()],
      openMarginEvents: [],
      activeCases: [makeCase({ status: "ready" })],
      reasonCodes: [],
      monitoringProgram: null,
    });
    assert.ok(actions.some((a) => a.actionCode === "resolve_crypto_distress"));
  });

  it("max 5 actions returned", () => {
    const positions = Array.from({ length: 10 }, (_, i) =>
      makePosition({
        id: `pos-${i}`,
        currentLtv: 0.85,
        custodyStatus: "unverified",
        valuationStatus: "stale",
      }),
    );
    const actions = deriveCryptoNextActions({
      positions,
      openMarginEvents: [],
      activeCases: [],
      reasonCodes: [],
      monitoringProgram: null,
    });
    assert.ok(actions.length <= 5);
  });
});

// ─── F. Protection readiness ──────────────────────────────────────────────────

describe("deriveCryptoProtectionReadiness", () => {
  it("not_applicable with no events or cases", () => {
    assert.equal(
      deriveCryptoProtectionReadiness({ openMarginEvents: [], activeCases: [] }),
      "not_applicable",
    );
  });

  it("review_required with open events, no case", () => {
    assert.equal(
      deriveCryptoProtectionReadiness({
        openMarginEvents: [makeMarginEvent()],
        activeCases: [],
      }),
      "review_required",
    );
  });

  it("active_case_open with open case", () => {
    assert.equal(
      deriveCryptoProtectionReadiness({
        openMarginEvents: [makeMarginEvent()],
        activeCases: [makeCase()],
      }),
      "active_case_open",
    );
  });

  it("stalled with stalled case", () => {
    assert.equal(
      deriveCryptoProtectionReadiness({
        openMarginEvents: [],
        activeCases: [makeCase({ status: "stalled" })],
      }),
      "stalled",
    );
  });
});

// ─── Explanations ─────────────────────────────────────────────────────────────

describe("buildCryptoExplanations", () => {
  it("returns explanations for no positions", () => {
    const result = buildCryptoExplanations({
      cryptoRelationshipStatus: "not_applicable",
      cryptoCollateralHealth: "unknown",
      activeCryptoPositionCount: 0,
      activeMarginCallCount: 0,
      triggerMonitoringCadence: "manual",
      currentWeightedLtv: null,
      reasonCodes: [],
      nextActions: [],
    });
    assert.ok(result.length > 0);
    assert.ok(result[0].includes("No active"));
  });

  it("returns max 5 explanations", () => {
    const result = buildCryptoExplanations({
      cryptoRelationshipStatus: "liquidation_review_required",
      cryptoCollateralHealth: "critical",
      activeCryptoPositionCount: 5,
      activeMarginCallCount: 3,
      triggerMonitoringCadence: "15m",
      currentWeightedLtv: 0.92,
      reasonCodes: [
        { code: "liquidation_threshold_breached", severity: "critical", evidence: {} },
        { code: "cure_period_expired", severity: "critical", evidence: {} },
      ],
      nextActions: [],
    });
    assert.ok(result.length <= 5);
    assert.ok(result.length >= 2);
  });
});
