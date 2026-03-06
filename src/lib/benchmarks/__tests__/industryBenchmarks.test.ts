import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getRevenueTier,
  lookupBenchmark,
  benchmarkRatio,
  benchmarkAll,
  getNaicsDescription,
  getSupportedNaicsCodes,
  getAvailableMetrics,
} from "../industryBenchmarks";

// ---------------------------------------------------------------------------
// getRevenueTier
// ---------------------------------------------------------------------------

describe("getRevenueTier", () => {
  it("classifies < $1M as under_1m", () => {
    assert.equal(getRevenueTier(500_000), "under_1m");
  });
  it("classifies $1M–$5M as 1m_5m", () => {
    assert.equal(getRevenueTier(3_000_000), "1m_5m");
  });
  it("classifies $5M–$25M as 5m_25m", () => {
    assert.equal(getRevenueTier(10_000_000), "5m_25m");
  });
  it("classifies $25M–$100M as 25m_100m", () => {
    assert.equal(getRevenueTier(50_000_000), "25m_100m");
  });
  it("classifies > $100M as over_100m", () => {
    assert.equal(getRevenueTier(200_000_000), "over_100m");
  });
});

// ---------------------------------------------------------------------------
// lookupBenchmark
// ---------------------------------------------------------------------------

describe("lookupBenchmark", () => {
  it("returns percentiles for a known NAICS and metric", () => {
    const result = lookupBenchmark("332710", "GROSS_MARGIN", 10_000_000);
    assert.ok(result);
    assert.ok(result.percentiles.p25 > 0);
    assert.ok(result.percentiles.p50 > result.percentiles.p25);
    assert.ok(result.percentiles.p75 > result.percentiles.p50);
    assert.ok(result.percentiles.p90 > result.percentiles.p75);
    assert.equal(result.naicsDescription, "Machine shops");
    assert.equal(result.revenueTier, "5m_25m");
  });

  it("returns null for unknown NAICS", () => {
    const result = lookupBenchmark("999999", "GROSS_MARGIN", 10_000_000);
    assert.equal(result, null);
  });

  it("applies tier adjustments — smaller companies have lower margins", () => {
    const small = lookupBenchmark("332710", "GROSS_MARGIN", 500_000);
    const large = lookupBenchmark("332710", "GROSS_MARGIN", 50_000_000);
    assert.ok(small);
    assert.ok(large);
    assert.ok(large.percentiles.p50 > small.percentiles.p50);
  });

  it("returns null for metrics not applicable to industry", () => {
    // Professional services don't have DIO (no inventory)
    const result = lookupBenchmark("541110", "DIO", 5_000_000);
    assert.equal(result, null);
  });

  it("uses NAICS overrides when available", () => {
    // Grocery stores have higher inventory turnover than generic retail
    const grocery = lookupBenchmark("445110", "INVENTORY_TURNOVER", 10_000_000);
    const genericRetail = lookupBenchmark("442110", "INVENTORY_TURNOVER", 10_000_000);
    assert.ok(grocery);
    assert.ok(genericRetail);
    assert.ok(grocery.percentiles.p50 > genericRetail.percentiles.p50);
  });

  it("resolves by 4-digit prefix for unknown 6-digit NAICS", () => {
    // 332799 not in catalog but 332710 is; should match via 3327 prefix
    const result = lookupBenchmark("332799", "GROSS_MARGIN", 10_000_000);
    assert.ok(result);
    assert.equal(result.naicsDescription, "Machine shops");
  });

  it("resolves by 2-digit prefix for unknown NAICS", () => {
    // 334000 not in catalog but 33xxxx manufacturing codes are
    const result = lookupBenchmark("334000", "GROSS_MARGIN", 10_000_000);
    assert.ok(result);
  });
});

// ---------------------------------------------------------------------------
// benchmarkRatio — core comparison
// ---------------------------------------------------------------------------

describe("benchmarkRatio", () => {
  it("returns full benchmark output for a known ratio", () => {
    const result = benchmarkRatio(0.35, "GROSS_MARGIN", "332710", 10_000_000);
    assert.ok(result);
    assert.equal(result.value, 0.35);
    assert.equal(result.canonicalKey, "GROSS_MARGIN");
    assert.equal(result.industryNaics, "332710");
    assert.ok(result.percentile >= 0 && result.percentile <= 100);
    assert.ok(["strong", "adequate", "weak", "concerning"].includes(result.assessment));
    assert.ok(result.peerMedian > 0);
    assert.ok(result.narrative.length > 0);
    assert.ok(result.narrative.includes("Gross margin"));
    assert.ok(result.narrative.includes("332710"));
    assert.ok(result.narrative.includes("percentile"));
  });

  it("strong assessment for above-p75 value (higher-is-better)", () => {
    // Manufacturing gross margin p75 ≈ 0.40 → 0.50 should be strong
    const result = benchmarkRatio(0.50, "GROSS_MARGIN", "332710", 10_000_000);
    assert.ok(result);
    assert.equal(result.assessment, "strong");
    assert.ok(result.percentile >= 75);
  });

  it("concerning assessment for below-p25 value (higher-is-better)", () => {
    // Manufacturing gross margin p25 ≈ 0.20 → 0.10 should be concerning
    const result = benchmarkRatio(0.10, "GROSS_MARGIN", "332710", 10_000_000);
    assert.ok(result);
    assert.equal(result.assessment, "concerning");
    assert.ok(result.percentile < 25);
  });

  it("handles lower-is-better metrics correctly (DSO)", () => {
    // Manufacturing DSO p25 ≈ 25 days → 20 days should be strong (lower is better)
    const result = benchmarkRatio(20, "DSO", "332710", 10_000_000);
    assert.ok(result);
    assert.equal(result.assessment, "strong");
    assert.ok(result.percentile >= 75);
  });

  it("weak/concerning for high DSO (lower-is-better)", () => {
    // Manufacturing DSO p75 ≈ 52 → 80 days should be concerning
    const result = benchmarkRatio(80, "DSO", "332710", 10_000_000);
    assert.ok(result);
    assert.ok(result.assessment === "weak" || result.assessment === "concerning");
  });

  it("generates proper narrative with DSO units", () => {
    const result = benchmarkRatio(45, "DSO", "423300", 10_000_000);
    assert.ok(result);
    assert.ok(result.narrative.includes("days"));
    assert.ok(result.narrative.includes("median"));
  });

  it("returns null for unknown NAICS", () => {
    const result = benchmarkRatio(0.30, "GROSS_MARGIN", "999999", 10_000_000);
    assert.equal(result, null);
  });

  it("generates narrative matching spec example format", () => {
    // Spec example: "DSO of 72 days is at the 38th percentile for NAICS 4230..."
    const result = benchmarkRatio(72, "DSO", "423300", 10_000_000);
    assert.ok(result);
    assert.ok(result.narrative.includes("DSO of 72 days"));
    assert.ok(result.narrative.includes("percentile for NAICS 423300"));
    assert.ok(result.narrative.includes("industry median is"));
  });
});

// ---------------------------------------------------------------------------
// benchmarkAll — batch comparison
// ---------------------------------------------------------------------------

describe("benchmarkAll", () => {
  it("benchmarks all provided metrics at once", () => {
    const results = benchmarkAll(
      {
        GROSS_MARGIN: 0.30,
        EBITDA_MARGIN: 0.12,
        DSCR: 1.5,
        DSO: 40,
        CURRENT_RATIO: 1.8,
      },
      "332710",
      10_000_000,
    );
    assert.ok(results.length >= 5);
    assert.ok(results.every((r) => r.percentile >= 0 && r.percentile <= 100));
    assert.ok(results.every((r) => r.narrative.length > 0));
  });

  it("skips undefined/null metrics", () => {
    const results = benchmarkAll(
      { GROSS_MARGIN: 0.30 },
      "332710",
      10_000_000,
    );
    assert.ok(results.length >= 1);
    assert.ok(results.every((r) => r.canonicalKey === "GROSS_MARGIN"));
  });
});

// ---------------------------------------------------------------------------
// Catalog queries
// ---------------------------------------------------------------------------

describe("catalog queries", () => {
  it("getNaicsDescription returns description for known code", () => {
    const desc = getNaicsDescription("722511");
    assert.equal(desc, "Full-service restaurants");
  });

  it("getNaicsDescription returns null for unknown code", () => {
    assert.equal(getNaicsDescription("999999"), null);
  });

  it("getSupportedNaicsCodes returns 50 codes", () => {
    const codes = getSupportedNaicsCodes();
    assert.equal(codes.length, 50);
  });

  it("getAvailableMetrics returns metrics for an industry", () => {
    const metrics = getAvailableMetrics("332710");
    assert.ok(metrics.includes("GROSS_MARGIN"));
    assert.ok(metrics.includes("DSCR"));
    assert.ok(metrics.includes("DSO"));
  });

  it("service industries don't have DIO/DPO/INVENTORY_TURNOVER", () => {
    const metrics = getAvailableMetrics("541110"); // lawyers
    assert.ok(!metrics.includes("DIO"));
    assert.ok(!metrics.includes("DPO"));
    assert.ok(!metrics.includes("INVENTORY_TURNOVER"));
  });
});
