import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { deriveRelationshipDistressState } from "../deriveRelationshipDistressState";
import { checkDistressSLA } from "../checkDistressSLA";
import { validateResolution } from "../validateResolution";
import { WATCHLIST_REVIEW_CADENCE, WORKOUT_MILESTONE_CADENCE } from "../types";

// ─── Distress state derivation ────────────────────────────────────────────────

describe("deriveRelationshipDistressState", () => {
  it("healthy with no deals", () => {
    assert.equal(deriveRelationshipDistressState({ deals: [] }), "healthy");
  });

  it("healthy with performing deals", () => {
    assert.equal(
      deriveRelationshipDistressState({
        deals: [{ dealId: "d1", operatingState: "performing", activeWatchlistSeverity: null, activeWorkoutSeverity: null }],
      }),
      "healthy",
    );
  });

  it("watchlist_exposure with active watchlist", () => {
    assert.equal(
      deriveRelationshipDistressState({
        deals: [{ dealId: "d1", operatingState: "watchlist", activeWatchlistSeverity: "high", activeWorkoutSeverity: null }],
      }),
      "watchlist_exposure",
    );
  });

  it("workout_exposure with active workout", () => {
    assert.equal(
      deriveRelationshipDistressState({
        deals: [{ dealId: "d1", operatingState: "workout", activeWatchlistSeverity: null, activeWorkoutSeverity: "critical" }],
      }),
      "workout_exposure",
    );
  });

  it("mixed_distress with both", () => {
    assert.equal(
      deriveRelationshipDistressState({
        deals: [
          { dealId: "d1", operatingState: "watchlist", activeWatchlistSeverity: "high", activeWorkoutSeverity: null },
          { dealId: "d2", operatingState: "workout", activeWatchlistSeverity: null, activeWorkoutSeverity: "critical" },
        ],
      }),
      "mixed_distress",
    );
  });

  it("monitored state", () => {
    assert.equal(
      deriveRelationshipDistressState({
        deals: [{ dealId: "d1", operatingState: "monitored", activeWatchlistSeverity: null, activeWorkoutSeverity: null }],
      }),
      "monitored",
    );
  });

  it("resolved state", () => {
    assert.equal(
      deriveRelationshipDistressState({
        deals: [{ dealId: "d1", operatingState: "resolved", activeWatchlistSeverity: null, activeWorkoutSeverity: null }],
      }),
      "resolved",
    );
  });

  it("deterministic for same input", () => {
    const input = {
      deals: [
        { dealId: "d1", operatingState: "watchlist", activeWatchlistSeverity: "high", activeWorkoutSeverity: null },
        { dealId: "d2", operatingState: "performing", activeWatchlistSeverity: null, activeWorkoutSeverity: null },
      ],
    };
    assert.equal(
      deriveRelationshipDistressState(input),
      deriveRelationshipDistressState(input),
    );
  });
});

// ─── SLA checking ─────────────────────────────────────────────────────────────

describe("checkDistressSLA", () => {
  const nowIso = "2026-03-29T12:00:00Z";

  it("review overdue for critical watchlist", () => {
    const result = checkDistressSLA({
      caseType: "watchlist",
      severity: "critical",
      stage: null,
      lastReviewAt: "2026-03-20T12:00:00Z", // 9 days ago, critical = 3 day cadence
      nextMilestoneDueAt: null,
      lastMaterialActivityAt: "2026-03-25T12:00:00Z",
      nowIso,
    });
    assert.equal(result.reviewOverdue, true);
  });

  it("review not overdue for low severity watchlist", () => {
    const result = checkDistressSLA({
      caseType: "watchlist",
      severity: "low",
      stage: null,
      lastReviewAt: "2026-03-15T12:00:00Z", // 14 days ago, low = 30 day cadence
      nextMilestoneDueAt: null,
      lastMaterialActivityAt: "2026-03-25T12:00:00Z",
      nowIso,
    });
    assert.equal(result.reviewOverdue, false);
  });

  it("milestone overdue for workout", () => {
    const result = checkDistressSLA({
      caseType: "workout",
      severity: "critical",
      stage: "triage",
      lastReviewAt: null,
      nextMilestoneDueAt: "2026-03-20T00:00:00Z", // past
      lastMaterialActivityAt: "2026-03-25T12:00:00Z",
      nowIso,
    });
    assert.equal(result.milestoneOverdue, true);
  });

  it("stalled detection", () => {
    const result = checkDistressSLA({
      caseType: "workout",
      severity: "high",
      stage: "diagnosis",
      lastReviewAt: null,
      nextMilestoneDueAt: null,
      lastMaterialActivityAt: "2026-03-10T12:00:00Z", // 19 days ago
      nowIso,
    });
    assert.equal(result.stalled, true);
    assert.ok(result.stalledDays >= 14);
  });

  it("not stalled with recent activity", () => {
    const result = checkDistressSLA({
      caseType: "workout",
      severity: "high",
      stage: "diagnosis",
      lastReviewAt: null,
      nextMilestoneDueAt: null,
      lastMaterialActivityAt: "2026-03-28T12:00:00Z", // 1 day ago
      nowIso,
    });
    assert.equal(result.stalled, false);
  });
});

// ─── Resolution validation ────────────────────────────────────────────────────

describe("validateResolution", () => {
  it("valid when all requirements met", () => {
    const result = validateResolution({
      openActionItemCount: 0,
      waivedActionItemCount: 0,
      hasResolutionOutcome: true,
      hasBankerSummary: true,
      hasEvidenceAttached: true,
      isReturnToPass: false,
      hasPassRationale: false,
    });
    assert.equal(result.valid, true);
    assert.equal(result.blockers.length, 0);
  });

  it("blocks on open action items", () => {
    const result = validateResolution({
      openActionItemCount: 3,
      waivedActionItemCount: 0,
      hasResolutionOutcome: true,
      hasBankerSummary: true,
      hasEvidenceAttached: true,
      isReturnToPass: false,
      hasPassRationale: false,
    });
    assert.equal(result.valid, false);
    assert.ok(result.blockers.some((b) => b.includes("action item")));
  });

  it("blocks on missing outcome", () => {
    const result = validateResolution({
      openActionItemCount: 0,
      waivedActionItemCount: 0,
      hasResolutionOutcome: false,
      hasBankerSummary: true,
      hasEvidenceAttached: true,
      isReturnToPass: false,
      hasPassRationale: false,
    });
    assert.equal(result.valid, false);
  });

  it("blocks on missing evidence", () => {
    const result = validateResolution({
      openActionItemCount: 0,
      waivedActionItemCount: 0,
      hasResolutionOutcome: true,
      hasBankerSummary: true,
      hasEvidenceAttached: false,
      isReturnToPass: false,
      hasPassRationale: false,
    });
    assert.equal(result.valid, false);
  });

  it("blocks return-to-pass without rationale", () => {
    const result = validateResolution({
      openActionItemCount: 0,
      waivedActionItemCount: 0,
      hasResolutionOutcome: true,
      hasBankerSummary: true,
      hasEvidenceAttached: true,
      isReturnToPass: true,
      hasPassRationale: false,
    });
    assert.equal(result.valid, false);
    assert.ok(result.blockers.some((b) => b.includes("pass rationale")));
  });

  it("allows return-to-pass with rationale", () => {
    const result = validateResolution({
      openActionItemCount: 0,
      waivedActionItemCount: 0,
      hasResolutionOutcome: true,
      hasBankerSummary: true,
      hasEvidenceAttached: true,
      isReturnToPass: true,
      hasPassRationale: true,
    });
    assert.equal(result.valid, true);
  });
});

// ─── Cadence constants ────────────────────────────────────────────────────────

describe("SLA cadence constants", () => {
  it("watchlist cadence has all severities", () => {
    const severities = WATCHLIST_REVIEW_CADENCE.map((c) => c.severity);
    assert.ok(severities.includes("low"));
    assert.ok(severities.includes("moderate"));
    assert.ok(severities.includes("high"));
    assert.ok(severities.includes("critical"));
  });

  it("workout cadence has all stages", () => {
    assert.ok(WORKOUT_MILESTONE_CADENCE.length >= 7);
  });

  it("critical watchlist has shortest cadence", () => {
    const critical = WATCHLIST_REVIEW_CADENCE.find((c) => c.severity === "critical");
    const low = WATCHLIST_REVIEW_CADENCE.find((c) => c.severity === "low");
    assert.ok(critical!.reviewIntervalDays < low!.reviewIntervalDays);
  });
});

// ─── Pure file guards ─────────────────────────────────────────────────────────

describe("Special assets fusion pure file guards", () => {
  const DIR = path.resolve(__dirname, "..");
  const PURE_FILES = [
    "types.ts",
    "deriveRelationshipDistressState.ts",
    "checkDistressSLA.ts",
    "validateResolution.ts",
  ];

  it("no DB imports", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("supabaseAdmin"), `${f} must not import supabaseAdmin`);
    }
  });

  it("no Math.random", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("Math.random"), `${f} must not use Math.random`);
    }
  });

  it("no Date.now", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("Date.now"), `${f} must not use Date.now`);
    }
  });
});
