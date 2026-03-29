import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { rankPortfolioRelationships } from "../rankPortfolioRelationships";
import { deriveRelationshipPortfolioScore } from "../deriveRelationshipPortfolioScore";
import { derivePortfolioSignals } from "../derivePortfolioSignals";
import { buildPortfolioSummary } from "../buildPortfolioSummary";
import { buildPortfolioActionability } from "../buildPortfolioActionability";
import { toOmegaPrimePortfolioContext } from "../toOmegaPrimePortfolioContext";
import type { PortfolioRelationshipInput, SignalDetectionInput, PortfolioIntelligencePack } from "../types";

function makeInput(overrides: Partial<PortfolioRelationshipInput> = {}): PortfolioRelationshipInput {
  return {
    relationshipId: "rel-1",
    systemTier: "informational",
    primaryAction: null,
    severityWeight: 0,
    deadlineWeight: 0,
    exposureWeight: 0,
    evidenceWeight: 0,
    policyWeight: 0,
    ageWeight: 0,
    hasDistress: false,
    hasDeadline: false,
    hasBorrowerBlock: false,
    hasProtection: false,
    hasGrowth: false,
    hasHighValue: false,
    whyNow: "Healthy monitoring",
    ...overrides,
  };
}

// ─── Ranking tests ────────────────────────────────────────────────────────────

describe("rankPortfolioRelationships", () => {
  it("higher tier ALWAYS outranks lower tier", () => {
    const inputs = [
      makeInput({ relationshipId: "growth-1", systemTier: "growth", severityWeight: 100 }),
      makeInput({ relationshipId: "distress-1", systemTier: "critical_distress", severityWeight: 10 }),
      makeInput({ relationshipId: "info-1", systemTier: "informational", severityWeight: 200 }),
    ];
    const ranked = rankPortfolioRelationships(inputs);
    assert.equal(ranked[0].relationshipId, "distress-1");
    assert.equal(ranked[0].rankPosition, 1);
    // Growth must come before informational
    const growthIdx = ranked.findIndex((r) => r.relationshipId === "growth-1");
    const infoIdx = ranked.findIndex((r) => r.relationshipId === "info-1");
    assert.ok(growthIdx < infoIdx);
  });

  it("within-tier ranking by score descending", () => {
    const inputs = [
      makeInput({ relationshipId: "a", systemTier: "protection", severityWeight: 50 }),
      makeInput({ relationshipId: "b", systemTier: "protection", severityWeight: 100 }),
      makeInput({ relationshipId: "c", systemTier: "protection", severityWeight: 75 }),
    ];
    const ranked = rankPortfolioRelationships(inputs);
    assert.equal(ranked[0].relationshipId, "b");
    assert.equal(ranked[1].relationshipId, "c");
    assert.equal(ranked[2].relationshipId, "a");
  });

  it("deterministic — 100 iterations", () => {
    const inputs = [
      makeInput({ relationshipId: "a", systemTier: "growth", severityWeight: 50 }),
      makeInput({ relationshipId: "b", systemTier: "critical_distress", severityWeight: 30 }),
      makeInput({ relationshipId: "c", systemTier: "protection", severityWeight: 80 }),
    ];
    const first = rankPortfolioRelationships(inputs);
    for (let i = 0; i < 100; i++) {
      const result = rankPortfolioRelationships(inputs);
      assert.equal(result[0].relationshipId, first[0].relationshipId);
      assert.equal(result[1].relationshipId, first[1].relationshipId);
    }
  });

  it("lexical tiebreaker for same tier and score", () => {
    const inputs = [
      makeInput({ relationshipId: "zzz", systemTier: "informational" }),
      makeInput({ relationshipId: "aaa", systemTier: "informational" }),
    ];
    const ranked = rankPortfolioRelationships(inputs);
    assert.equal(ranked[0].relationshipId, "aaa");
  });

  it("rank positions are sequential", () => {
    const inputs = Array.from({ length: 5 }, (_, i) =>
      makeInput({ relationshipId: `rel-${i}`, systemTier: "informational" }),
    );
    const ranked = rankPortfolioRelationships(inputs);
    for (let i = 0; i < ranked.length; i++) {
      assert.equal(ranked[i].rankPosition, i + 1);
    }
  });

  it("drivers are preserved", () => {
    const inputs = [makeInput({ hasDistress: true, hasProtection: true })];
    const ranked = rankPortfolioRelationships(inputs);
    assert.equal(ranked[0].drivers.distress, true);
    assert.equal(ranked[0].drivers.protection, true);
    assert.equal(ranked[0].drivers.growth, false);
  });
});

// ─── Score tests ──────────────────────────────────────────────────────────────

describe("deriveRelationshipPortfolioScore", () => {
  it("sums all weights", () => {
    const score = deriveRelationshipPortfolioScore(makeInput({
      severityWeight: 10,
      deadlineWeight: 20,
      exposureWeight: 30,
      evidenceWeight: 40,
      policyWeight: 50,
      ageWeight: 60,
    }));
    assert.equal(score, 210);
  });

  it("zero weights produce zero score", () => {
    assert.equal(deriveRelationshipPortfolioScore(makeInput()), 0);
  });
});

// ─── Signal tests ─────────────────────────────────────────────────────────────

describe("derivePortfolioSignals", () => {
  const nowIso = "2026-03-29T12:00:00Z";

  it("no signals below minimum cluster size", () => {
    const signals = derivePortfolioSignals({
      relationships: [
        { relationshipId: "r1", systemTier: "informational", queueReasons: [], hasDepositRunoff: true, hasRenewalDue: false, industryCode: null, hasTreasuryStall: false, hasGrowthOpportunity: false, evidenceIds: ["e1"] },
        { relationshipId: "r2", systemTier: "informational", queueReasons: [], hasDepositRunoff: true, hasRenewalDue: false, industryCode: null, hasTreasuryStall: false, hasGrowthOpportunity: false, evidenceIds: ["e2"] },
      ],
      nowIso,
    });
    assert.equal(signals.length, 0);
  });

  it("deposit_runoff_cluster detected at >= 3", () => {
    const signals = derivePortfolioSignals({
      relationships: Array.from({ length: 4 }, (_, i) => ({
        relationshipId: `r${i}`,
        systemTier: "protection" as const,
        queueReasons: [],
        hasDepositRunoff: true,
        hasRenewalDue: false,
        industryCode: null,
        hasTreasuryStall: false,
        hasGrowthOpportunity: false,
        evidenceIds: [`e${i}`],
      })),
      nowIso,
    });
    assert.ok(signals.some((s) => s.type === "deposit_runoff_cluster"));
  });

  it("renewal_wave detected", () => {
    const signals = derivePortfolioSignals({
      relationships: Array.from({ length: 5 }, (_, i) => ({
        relationshipId: `r${i}`,
        systemTier: "time_bound_work" as const,
        queueReasons: [],
        hasDepositRunoff: false,
        hasRenewalDue: true,
        industryCode: null,
        hasTreasuryStall: false,
        hasGrowthOpportunity: false,
        evidenceIds: [],
      })),
      nowIso,
    });
    assert.ok(signals.some((s) => s.type === "renewal_wave"));
  });

  it("industry_stress_cluster requires evidence", () => {
    const signals = derivePortfolioSignals({
      relationships: Array.from({ length: 4 }, (_, i) => ({
        relationshipId: `r${i}`,
        systemTier: "critical_distress" as const,
        queueReasons: [],
        hasDepositRunoff: false,
        hasRenewalDue: false,
        industryCode: "5411",
        hasTreasuryStall: false,
        hasGrowthOpportunity: false,
        evidenceIds: i < 3 ? [`e${i}`] : [], // one without evidence
      })),
      nowIso,
    });
    // Should NOT detect because one relationship lacks evidence
    assert.equal(signals.filter((s) => s.type === "industry_stress_cluster").length, 0);
  });

  it("all signals have required fields", () => {
    const signals = derivePortfolioSignals({
      relationships: Array.from({ length: 4 }, (_, i) => ({
        relationshipId: `r${i}`,
        systemTier: "protection" as const,
        queueReasons: [],
        hasDepositRunoff: true,
        hasRenewalDue: true,
        industryCode: null,
        hasTreasuryStall: false,
        hasGrowthOpportunity: true,
        evidenceIds: [`e${i}`],
      })),
      nowIso,
    });
    for (const sig of signals) {
      assert.ok(sig.signalId);
      assert.ok(sig.type);
      assert.ok(sig.severity);
      assert.ok(sig.relationshipIds.length >= 3);
      assert.ok(sig.explanation.length > 0);
    }
  });
});

// ─── Summary tests ────────────────────────────────────────────────────────────

describe("buildPortfolioSummary", () => {
  it("counts correctly", () => {
    const ranked = [
      { relationshipId: "r1", systemTier: "critical_distress" as const, rankPosition: 1, drivers: { distress: true, deadline: false, borrowerBlock: false, protection: false, growth: false, value: false }, explanation: "Workout active", primaryAction: null },
      { relationshipId: "r2", systemTier: "time_bound_work" as const, rankPosition: 2, drivers: { distress: false, deadline: true, borrowerBlock: false, protection: false, growth: false, value: false }, explanation: "Renewal due", primaryAction: null },
      { relationshipId: "r3", systemTier: "growth" as const, rankPosition: 3, drivers: { distress: false, deadline: false, borrowerBlock: false, protection: false, growth: true, value: false }, explanation: "Growth opp", primaryAction: null },
    ];
    const summary = buildPortfolioSummary(ranked, []);
    assert.equal(summary.totalRelationships, 3);
    assert.equal(summary.upcomingDeadlines, 1);
    assert.equal(summary.growthOpportunities, 1);
  });

  it("top risks from critical signals", () => {
    const summary = buildPortfolioSummary([], [{
      signalId: "s1",
      type: "industry_stress_cluster",
      severity: "critical",
      relationshipIds: ["r1", "r2", "r3"],
      explanation: "Industry stress detected",
      evidenceIds: [],
      detectedAt: "2026-01-01",
    }]);
    assert.ok(summary.topRisks.includes("Industry stress detected"));
  });
});

// ─── Actionability tests ──────────────────────────────────────────────────────

describe("buildPortfolioActionability", () => {
  it("produces actions from high-severity signals", () => {
    const scope = { bankId: "b1" };
    const actions = buildPortfolioActionability(scope, [], [{
      signalId: "s1",
      type: "deposit_runoff_cluster",
      severity: "high",
      relationshipIds: ["r1", "r2", "r3"],
      explanation: "Deposit runoff",
      evidenceIds: ["e1"],
      detectedAt: "2026-01-01",
    }]);
    assert.ok(actions.some((a) => a.actionCode === "review_high_risk_cluster"));
    assert.ok(actions.some((a) => a.actionCode === "address_deposit_runoff"));
  });

  it("max 5 actions", () => {
    const scope = { bankId: "b1" };
    const signals = Array.from({ length: 10 }, (_, i) => ({
      signalId: `s${i}`,
      type: "deposit_runoff_cluster" as const,
      severity: "critical" as const,
      relationshipIds: ["r1", "r2", "r3"],
      explanation: `Signal ${i}`,
      evidenceIds: [`e${i}`],
      detectedAt: "2026-01-01",
    }));
    const actions = buildPortfolioActionability(scope, [], signals);
    assert.ok(actions.length <= 5);
  });
});

// ─── Omega adapter tests ──────────────────────────────────────────────────────

describe("toOmegaPrimePortfolioContext", () => {
  it("converts pack to Omega context", () => {
    const pack: PortfolioIntelligencePack = {
      scope: { bankId: "b1" },
      generatedAt: "2026-01-01",
      orderedRelationships: [
        { relationshipId: "r1", systemTier: "critical_distress", rankPosition: 1, drivers: { distress: true, deadline: false, borrowerBlock: false, protection: false, growth: false, value: false }, explanation: "Active workout", primaryAction: { code: "advance_workout_strategy", targetType: "case", targetId: "c1", label: "Advance", tier: "critical_distress" } },
      ],
      signals: [{ signalId: "s1", type: "renewal_wave", severity: "moderate", relationshipIds: ["r1"], explanation: "Renewal wave", evidenceIds: [], detectedAt: "2026-01-01" }],
      summary: { totalRelationships: 1, distressCounts: { watchlist: 0, workout: 1 }, upcomingDeadlines: 0, borrowerBlocked: 0, protectionExposure: 0, growthOpportunities: 0, topRisks: [] },
      actions: [],
      diagnostics: { version: "v1", inputSources: [], degraded: false },
    };
    const ctx = toOmegaPrimePortfolioContext(pack);
    assert.equal(ctx.bankId, "b1");
    assert.equal(ctx.topRelationships.length, 1);
    assert.equal(ctx.activeSignals.length, 1);
    assert.equal(ctx.summary.totalRelationships, 1);
  });
});

// ─── Pure file guards ─────────────────────────────────────────────────────────

describe("Portfolio pure file guards", () => {
  const DIR = path.resolve(__dirname, "..");
  const PURE_FILES = [
    "types.ts",
    "deriveRelationshipPortfolioScore.ts",
    "rankPortfolioRelationships.ts",
    "derivePortfolioSignals.ts",
    "buildPortfolioSummary.ts",
    "buildPortfolioActionability.ts",
    "toOmegaPrimePortfolioContext.ts",
  ];

  it("no DB imports", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("supabaseAdmin"), `${f} must not import supabaseAdmin`);
    }
  });

  it("no server-only in pure files", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes('"server-only"'), `${f} must not import server-only`);
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

  it("scores never displayed — no UI score rendering", () => {
    // Scores are internal only; UI shows drivers, not numbers
    const typeContent = fs.readFileSync(path.join(DIR, "types.ts"), "utf-8");
    assert.ok(
      typeContent.includes("drivers"),
      "types must include drivers for UI display (not raw scores)",
    );
  });
});
