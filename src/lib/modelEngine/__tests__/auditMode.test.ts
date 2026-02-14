/**
 * Phase 12 — Institutional Audit Mode Tests
 *
 * Validates:
 * - Enriched envelope (schema_version: 2, registry/policy/hashes/explainability)
 * - evaluateMetricGraphWithAudit parity with evaluateMetricGraph
 * - computeSnapshotHash determinism
 * - POLICY_DEFINITIONS_VERSION stability
 * - Replay route structure
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// Envelope structure (static source analysis)
// ---------------------------------------------------------------------------

describe("Phase 12 — Enriched Envelope", () => {
  const src = readSource("src/lib/modelEngine/engineAuthority.ts");

  it("schema_version is 2", () => {
    assert.ok(src.includes("schema_version: 2"), "envelope must have schema_version: 2");
  });

  it("envelope contains registry_version", () => {
    assert.ok(
      src.includes("registry_version: registryVersion"),
      "envelope must include registry_version",
    );
  });

  it("envelope contains policy_version", () => {
    assert.ok(
      src.includes("policy_version: policyVersion"),
      "envelope must include policy_version",
    );
  });

  it("envelope contains snapshot_hash", () => {
    assert.ok(
      src.includes("snapshot_hash: snapshotHash"),
      "envelope must include snapshot_hash",
    );
  });

  it("envelope contains outputs_hash", () => {
    assert.ok(
      src.includes("outputs_hash: outputsHash"),
      "envelope must include outputs_hash",
    );
  });

  it("envelope contains explainability", () => {
    assert.ok(
      src.includes("explainability:"),
      "envelope must include explainability section",
    );
  });
});

// ---------------------------------------------------------------------------
// Functional: evaluateMetricGraphWithAudit
// ---------------------------------------------------------------------------

describe("Phase 12 — evaluateMetricGraphWithAudit", () => {
  it("returns dependencyGraph mapping metric keys to dependencies", async () => {
    const { evaluateMetricGraphWithAudit, getV1SeedDefinitions } =
      await import("../index");

    const defs = getV1SeedDefinitions();
    const base: Record<string, number | null> = {
      REVENUE: 1000000,
      COGS: 400000,
      NET_INCOME: 150000,
      TOTAL_ASSETS: 2000000,
      TOTAL_LIABILITIES: 800000,
      EQUITY: 1200000,
      EBITDA: 300000,
      DEBT_SERVICE: 100000,
    };

    const result = evaluateMetricGraphWithAudit(defs, base);

    assert.ok(result.dependencyGraph, "must return dependencyGraph");
    assert.ok(typeof result.dependencyGraph === "object", "dependencyGraph must be object");

    // Every metric in the definitions should appear in the graph
    for (const def of defs) {
      assert.ok(
        def.key in result.dependencyGraph,
        `dependencyGraph must include ${def.key}`,
      );
      assert.ok(
        Array.isArray(result.dependencyGraph[def.key]),
        `dependencyGraph[${def.key}] must be an array`,
      );
    }
  });

  it("values match evaluateMetricGraph (no logic divergence)", async () => {
    const { evaluateMetricGraph, evaluateMetricGraphWithAudit, getV1SeedDefinitions } =
      await import("../index");

    const defs = getV1SeedDefinitions();
    const base: Record<string, number | null> = {
      REVENUE: 500000,
      COGS: 200000,
      NET_INCOME: 80000,
      TOTAL_ASSETS: 1000000,
      TOTAL_LIABILITIES: 400000,
      EQUITY: 600000,
      EBITDA: 150000,
      DEBT_SERVICE: 50000,
      CURRENT_ASSETS: 300000,
      CURRENT_LIABILITIES: 150000,
    };

    const normalValues = evaluateMetricGraph(defs, base);
    const auditResult = evaluateMetricGraphWithAudit(defs, base);

    // Values must be identical
    for (const key of Object.keys(normalValues)) {
      assert.equal(
        auditResult.values[key],
        normalValues[key],
        `values must match for ${key}: audit=${auditResult.values[key]} vs normal=${normalValues[key]}`,
      );
    }
    for (const key of Object.keys(auditResult.values)) {
      assert.equal(
        auditResult.values[key],
        normalValues[key],
        `values must match for ${key}: audit=${auditResult.values[key]} vs normal=${normalValues[key]}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Functional: computeSnapshotHash determinism
// ---------------------------------------------------------------------------

describe("Phase 12 — computeSnapshotHash", () => {
  it("same inputs produce same hash", async () => {
    const { computeSnapshotHash } = await import("../hashSnapshot");

    const input = {
      facts: [{ fact_type: "T12", fact_key: "revenue", fact_value_num: 100000, fact_period_end: "2025-12-31" }],
      financialModel: { dealId: "deal-1", periods: [] },
      metrics: { REVENUE: 100000, DSCR: 1.25 },
      registry_version: "v1.0",
      policy_version: "abc123",
    };

    const hash1 = computeSnapshotHash(input);
    const hash2 = computeSnapshotHash(input);

    assert.equal(hash1, hash2, "identical inputs must produce identical hashes");
    assert.ok(typeof hash1 === "string" && hash1.length > 0, "hash must be non-empty string");
  });

  it("different inputs produce different hashes", async () => {
    const { computeSnapshotHash } = await import("../hashSnapshot");

    const base = {
      facts: [{ fact_type: "T12", fact_key: "revenue", fact_value_num: 100000, fact_period_end: "2025-12-31" }],
      financialModel: { dealId: "deal-1", periods: [] },
      metrics: { REVENUE: 100000 },
      registry_version: "v1.0",
      policy_version: "abc123",
    };

    const modified = {
      ...base,
      metrics: { REVENUE: 200000 },
    };

    const hash1 = computeSnapshotHash(base);
    const hash2 = computeSnapshotHash(modified);

    assert.notEqual(hash1, hash2, "different inputs must produce different hashes");
  });
});

// ---------------------------------------------------------------------------
// POLICY_DEFINITIONS_VERSION
// ---------------------------------------------------------------------------

describe("Phase 12 — POLICY_DEFINITIONS_VERSION", () => {
  it("is a hex string of length 16", async () => {
    const { POLICY_DEFINITIONS_VERSION } = await import("@/lib/policyEngine/version");
    assert.match(POLICY_DEFINITIONS_VERSION, /^[0-9a-f]{16}$/, "must be 16-char hex string");
  });

  it("is deterministic (same value on re-import)", async () => {
    const mod1 = await import("@/lib/policyEngine/version");
    const mod2 = await import("@/lib/policyEngine/version");
    assert.equal(
      mod1.POLICY_DEFINITIONS_VERSION,
      mod2.POLICY_DEFINITIONS_VERSION,
      "must be deterministic across imports",
    );
  });
});

// ---------------------------------------------------------------------------
// hashSnapshot.ts — no non-deterministic calls
// ---------------------------------------------------------------------------

describe("Phase 12 — hashSnapshot purity", () => {
  it("does not use Date.now or Math.random", () => {
    const src = readSource("src/lib/modelEngine/hashSnapshot.ts");
    assert.ok(!src.includes("Date.now"), "hashSnapshot must not use Date.now");
    assert.ok(!src.includes("Math.random"), "hashSnapshot must not use Math.random");
  });
});

// ---------------------------------------------------------------------------
// Replay route structure
// ---------------------------------------------------------------------------

describe("Phase 12 — Replay route", () => {
  it("replay route file exists", () => {
    const routePath = "src/app/api/deals/[dealId]/model-v2/replay/route.ts";
    assert.ok(fs.existsSync(path.resolve(routePath)), `${routePath} must exist`);
  });

  it("replay route contains version mismatch guards", () => {
    const src = readSource("src/app/api/deals/[dealId]/model-v2/replay/route.ts");
    assert.ok(
      src.includes("MODEL_SNAPSHOT_LEGACY_VERSION"),
      "replay route must handle legacy schema_version rejection",
    );
    assert.ok(
      src.includes("MODEL_REGISTRY_VERSION_MISMATCH"),
      "replay route must guard against registry version mismatch",
    );
    assert.ok(
      src.includes("MODEL_POLICY_VERSION_MISMATCH"),
      "replay route must guard against policy version mismatch",
    );
  });

  it("replay route computes snapshot hash for comparison", () => {
    const src = readSource("src/app/api/deals/[dealId]/model-v2/replay/route.ts");
    assert.ok(
      src.includes("computeSnapshotHash"),
      "replay route must use computeSnapshotHash for replay",
    );
    assert.ok(
      src.includes("hashMatch"),
      "replay route must compare replay hash to stored hash",
    );
  });
});
