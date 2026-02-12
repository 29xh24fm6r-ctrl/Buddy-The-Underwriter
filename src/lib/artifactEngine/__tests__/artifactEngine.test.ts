/**
 * Artifact Engine — Tests
 *
 * Tests hash stability, timestamp stripping, and overall hash computation.
 * Uses node:test + node:assert/strict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hashComponent, computeOverallHash, computeArtifactHashes } from "../hash";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_SNAPSHOT = {
  dealId: "test-deal",
  generatedAt: "2024-12-31T00:00:00Z",
  period: { periodId: "fy-2024", periodEnd: "2024-12-31", type: "FYE" },
  debtService: { totalDebtService: 40_000 },
  ratios: {
    periodId: "fy-2024",
    metrics: {
      dscr: { value: 2.5, inputs: {}, formula: "EBITDA / DS" },
    },
  },
};

const SAMPLE_POLICY = {
  product: "SBA",
  passed: true,
  failedMetrics: [],
  breaches: [],
  warnings: [],
  metricsEvaluated: { dscr: 2.5 },
  tier: "A",
};

const SAMPLE_STRESS = {
  baseline: { key: "BASELINE", label: "Baseline", policy: { tier: "A" } },
  scenarios: [{ key: "BASELINE", label: "Baseline", policy: { tier: "A" } }],
  worstTier: "A",
  tierDegraded: false,
};

const SAMPLE_PRICING = {
  product: "SBA",
  baseRate: 0.1125,
  riskPremiumBps: 0,
  stressAdjustmentBps: 0,
  finalRate: 0.1125,
  rationale: ["Base rate: PRIME 8.50% + 275bps = 11.25%"],
};

const SAMPLE_MEMO = {
  dealId: "test-deal",
  product: "SBA",
  recommendation: "APPROVE",
  sections: { executiveSummary: { title: "Summary", content: "Good deal" } },
  generatedAt: "2024-12-31T00:00:00Z",
};

const SAMPLE_MODEL = {
  dealId: "test-deal",
  periods: [
    {
      periodId: "fy-2024",
      periodEnd: "2024-12-31",
      type: "FYE",
      income: { revenue: 1_000_000 },
      balance: { totalAssets: 2_000_000 },
      cashflow: { ebitda: 400_000 },
      qualityFlags: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Hash Stability Tests
// ---------------------------------------------------------------------------

describe("hashComponent", () => {
  it("same input produces same hash", () => {
    const h1 = hashComponent(SAMPLE_SNAPSHOT);
    const h2 = hashComponent(SAMPLE_SNAPSHOT);
    assert.equal(h1, h2);
  });

  it("different inputs produce different hashes", () => {
    const h1 = hashComponent(SAMPLE_SNAPSHOT);
    const h2 = hashComponent({ ...SAMPLE_SNAPSHOT, dealId: "other-deal" });
    assert.notEqual(h1, h2);
  });

  it("timestamps are excluded from hash", () => {
    const withTimestamp = { ...SAMPLE_SNAPSHOT, generatedAt: "2024-12-31T00:00:00Z" };
    const withDifferentTimestamp = { ...SAMPLE_SNAPSHOT, generatedAt: "2025-06-15T12:00:00Z" };
    assert.equal(hashComponent(withTimestamp), hashComponent(withDifferentTimestamp));
  });

  it("createdAt is excluded from hash", () => {
    const a = { ...SAMPLE_POLICY, createdAt: "2024-01-01" };
    const b = { ...SAMPLE_POLICY, createdAt: "2025-12-31" };
    assert.equal(hashComponent(a), hashComponent(b));
  });

  it("hash is a valid hex string of 64 chars (SHA-256)", () => {
    const h = hashComponent(SAMPLE_SNAPSHOT);
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  it("handles null and undefined values", () => {
    const h1 = hashComponent(null);
    const h2 = hashComponent(undefined);
    assert.ok(h1);
    assert.ok(h2);
  });

  it("order of keys does not affect hash", () => {
    const a = { foo: 1, bar: 2, baz: 3 };
    const b = { baz: 3, foo: 1, bar: 2 };
    assert.equal(hashComponent(a), hashComponent(b));
  });
});

// ---------------------------------------------------------------------------
// Overall Hash Tests
// ---------------------------------------------------------------------------

describe("computeOverallHash", () => {
  it("produces consistent hash from component hashes", () => {
    const hashes = {
      modelHash: hashComponent(SAMPLE_MODEL),
      snapshotHash: hashComponent(SAMPLE_SNAPSHOT),
      policyHash: hashComponent(SAMPLE_POLICY),
      stressHash: hashComponent(SAMPLE_STRESS),
      pricingHash: hashComponent(SAMPLE_PRICING),
      memoHash: hashComponent(SAMPLE_MEMO),
    };

    const o1 = computeOverallHash(hashes);
    const o2 = computeOverallHash(hashes);
    assert.equal(o1, o2);
  });

  it("changes when any component hash changes", () => {
    const base = {
      modelHash: "aaa",
      snapshotHash: "bbb",
      policyHash: "ccc",
      stressHash: "ddd",
      pricingHash: "eee",
      memoHash: "fff",
    };

    const modified = { ...base, policyHash: "zzz" };
    assert.notEqual(computeOverallHash(base), computeOverallHash(modified));
  });
});

// ---------------------------------------------------------------------------
// Full Hash Computation Tests
// ---------------------------------------------------------------------------

describe("computeArtifactHashes", () => {
  it("returns all 7 hash fields", () => {
    const hashes = computeArtifactHashes({
      model: SAMPLE_MODEL,
      snapshot: SAMPLE_SNAPSHOT,
      policy: SAMPLE_POLICY,
      stress: SAMPLE_STRESS,
      pricing: SAMPLE_PRICING,
      memo: SAMPLE_MEMO,
    });

    assert.ok(hashes.modelHash);
    assert.ok(hashes.snapshotHash);
    assert.ok(hashes.policyHash);
    assert.ok(hashes.stressHash);
    assert.ok(hashes.pricingHash);
    assert.ok(hashes.memoHash);
    assert.ok(hashes.overallHash);
  });

  it("overall hash equals hash-of-component-hashes", () => {
    const hashes = computeArtifactHashes({
      model: SAMPLE_MODEL,
      snapshot: SAMPLE_SNAPSHOT,
      policy: SAMPLE_POLICY,
      stress: SAMPLE_STRESS,
      pricing: SAMPLE_PRICING,
      memo: SAMPLE_MEMO,
    });

    const expected = computeOverallHash({
      modelHash: hashes.modelHash,
      snapshotHash: hashes.snapshotHash,
      policyHash: hashes.policyHash,
      stressHash: hashes.stressHash,
      pricingHash: hashes.pricingHash,
      memoHash: hashes.memoHash,
    });

    assert.equal(hashes.overallHash, expected);
  });

  it("is deterministic — same inputs produce same hashes", () => {
    const components = {
      model: SAMPLE_MODEL,
      snapshot: SAMPLE_SNAPSHOT,
      policy: SAMPLE_POLICY,
      stress: SAMPLE_STRESS,
      pricing: SAMPLE_PRICING,
      memo: SAMPLE_MEMO,
    };

    const h1 = computeArtifactHashes(components);
    const h2 = computeArtifactHashes(components);

    assert.equal(h1.modelHash, h2.modelHash);
    assert.equal(h1.snapshotHash, h2.snapshotHash);
    assert.equal(h1.overallHash, h2.overallHash);
  });

  it("different model data produces different model hash", () => {
    const h1 = computeArtifactHashes({
      model: SAMPLE_MODEL,
      snapshot: SAMPLE_SNAPSHOT,
      policy: SAMPLE_POLICY,
      stress: SAMPLE_STRESS,
      pricing: SAMPLE_PRICING,
      memo: SAMPLE_MEMO,
    });

    const h2 = computeArtifactHashes({
      model: { ...SAMPLE_MODEL, dealId: "different-deal" },
      snapshot: SAMPLE_SNAPSHOT,
      policy: SAMPLE_POLICY,
      stress: SAMPLE_STRESS,
      pricing: SAMPLE_PRICING,
      memo: SAMPLE_MEMO,
    });

    assert.notEqual(h1.modelHash, h2.modelHash);
    assert.notEqual(h1.overallHash, h2.overallHash);
  });
});
