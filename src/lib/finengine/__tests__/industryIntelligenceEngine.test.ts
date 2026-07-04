/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 6 tests.
 *
 * Coverage completeness (all 12 sectors have every profile type), NAICS
 * resolution (longest-prefix), band assessment, and the aggregator.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  INDUSTRY_SECTORS,
  resolveSectorFromNaics,
  resolveIndustryIntelligence,
  industryIntelligenceForSector,
  assessAgainstBand,
  allSectorsHaveRiskProfiles,
  allSectorsHaveBenchmarks,
  allSectorsHaveStress,
  allSectorsHaveCovenantGuidance,
} from "@/lib/finengine/industry";

describe("PR6 — sector coverage completeness", () => {
  it("supports all 12 required sectors", () => {
    assert.equal(INDUSTRY_SECTORS.length, 12);
  });
  it("every sector has risk / benchmark / stress / covenant coverage", () => {
    assert.ok(allSectorsHaveRiskProfiles());
    assert.ok(allSectorsHaveBenchmarks());
    assert.ok(allSectorsHaveStress());
    assert.ok(allSectorsHaveCovenantGuidance());
  });
  it("every sector's parameters are versioned (no unexplained magic)", () => {
    for (const s of INDUSTRY_SECTORS) {
      const intel = industryIntelligenceForSector(s);
      assert.ok(intel.risk.version >= 1);
      assert.ok(intel.stress.version >= 1);
      assert.ok(intel.benchmarks.version >= 1);
      assert.ok(intel.covenants.version >= 1);
    }
  });
});

describe("PR6 — NAICS resolution (longest-prefix)", () => {
  it("62 → healthcare", () => {
    assert.equal(resolveSectorFromNaics("621111"), "HEALTHCARE_SERVICES");
  });
  it("23 → construction", () => {
    assert.equal(resolveSectorFromNaics("236220"), "CONSTRUCTION");
  });
  it("5112 (software) beats 54 (professional services) by longest prefix", () => {
    assert.equal(resolveSectorFromNaics("511210"), "SAAS_SOFTWARE");
  });
  it("722 → restaurants", () => {
    assert.equal(resolveSectorFromNaics("722511"), "RESTAURANTS");
  });
  it("unknown NAICS → null", () => {
    assert.equal(resolveSectorFromNaics("999999"), null);
    assert.equal(resolveSectorFromNaics(null), null);
  });
});

describe("PR6 — band assessment", () => {
  it("flags a value below the sector band", () => {
    // Manufacturing gross margin band 0.20–0.40.
    assert.equal(assessAgainstBand("MANUFACTURING", "GROSS_MARGIN", 0.1), "below");
    assert.equal(assessAgainstBand("MANUFACTURING", "GROSS_MARGIN", 0.3), "within");
    assert.equal(assessAgainstBand("MANUFACTURING", "GROSS_MARGIN", 0.5), "above");
  });
  it("returns no_band for an unbenchmarked metric / null value", () => {
    assert.equal(assessAgainstBand("MANUFACTURING", "SOME_METRIC", 1), "no_band");
    assert.equal(assessAgainstBand("MANUFACTURING", "GROSS_MARGIN", null), "no_band");
  });
});

describe("PR6 — aggregator", () => {
  it("resolves full intelligence bundle from NAICS", () => {
    const intel = resolveIndustryIntelligence("721110"); // hotels
    assert.equal(intel?.sector, "HOTELS");
    assert.equal(intel?.definition.primaryCollateral, "real_estate");
    assert.ok(intel?.stress.vacancyStressPct != null); // hotels carry CRE stress
    assert.ok(intel?.risk.keyRisks.length > 0);
    assert.ok(intel?.covenants.recommendedCovenants.includes("DSCR"));
  });
  it("null for unknown NAICS", () => {
    assert.equal(resolveIndustryIntelligence("000000"), null);
  });
});
