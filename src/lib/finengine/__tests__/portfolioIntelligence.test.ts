/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 17 tests.
 *
 * Concentration (with HHI), risk & watchlist migration, criticized/classified
 * exposure, vintage, and CECL segmentation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  industryConcentration,
  officerConcentration,
  riskMigration,
  watchlistMigration,
  criticizedClassifiedExposure,
  vintageAnalysis,
  ceclInputs,
  summarizePortfolio,
  type LoanRecord,
} from "@/lib/finengine/portfolio";

const loans: LoanRecord[] = [
  { loanId: "1", exposure: 5_000_000, industrySector: "CONSTRUCTION", officer: "A", riskRating: 5, priorRiskRating: 4, classification: "substandard", vintage: "2023" },
  { loanId: "2", exposure: 3_000_000, industrySector: "CONSTRUCTION", officer: "A", riskRating: 4, priorRiskRating: 4, classification: "special_mention", vintage: "2023" },
  { loanId: "3", exposure: 2_000_000, industrySector: "RESTAURANTS", officer: "B", riskRating: 3, priorRiskRating: 5, classification: "pass", vintage: "2024", watchlist: false, priorWatchlist: true },
  { loanId: "4", exposure: 1_000_000, industrySector: "MANUFACTURING", officer: "B", riskRating: 6, priorRiskRating: 4, classification: "pass", vintage: "2024", watchlist: true, priorWatchlist: false },
];

describe("PR17 — concentration", () => {
  it("industry concentration is sorted with HHI + top share", () => {
    const r = industryConcentration(loans);
    assert.equal(r.total, 11_000_000);
    assert.equal(r.buckets[0].key, "CONSTRUCTION");
    assert.ok(Math.abs(r.buckets[0].pct - 8_000_000 / 11_000_000) < 1e-9);
    assert.ok(r.hhi > 0 && r.hhi <= 1);
    assert.equal(r.top, r.buckets[0].pct);
  });

  it("officer concentration groups by officer", () => {
    const r = officerConcentration(loans);
    assert.equal(r.buckets.find((b) => b.key === "A")!.exposure, 8_000_000);
  });
});

describe("PR17 — migration", () => {
  it("risk migration counts up/down/stable + downgraded exposure", () => {
    const m = riskMigration(loans);
    // loan1 4→5 down, loan2 stable, loan3 5→3 up, loan4 4→6 down
    assert.equal(m.downgraded, 2);
    assert.equal(m.upgraded, 1);
    assert.equal(m.stable, 1);
    assert.equal(m.downgradedExposure, 5_000_000 + 1_000_000);
  });

  it("watchlist migration counts entries/exits", () => {
    const w = watchlistMigration(loans);
    assert.equal(w.entered, 1); // loan4
    assert.equal(w.exited, 1); // loan3
    assert.equal(w.enteredExposure, 1_000_000);
  });
});

describe("PR17 — criticized/classified", () => {
  it("splits criticized vs classified exposure", () => {
    const r = criticizedClassifiedExposure(loans);
    // criticized = special_mention + substandard = 3M + 5M = 8M
    assert.equal(r.criticizedExposure, 8_000_000);
    // classified excludes special_mention = 5M
    assert.equal(r.classifiedExposure, 5_000_000);
    assert.ok(Math.abs(r.criticizedPct - 8 / 11) < 1e-9);
  });
});

describe("PR17 — vintage + CECL", () => {
  it("vintage analysis reports criticized rate per vintage", () => {
    const v = vintageAnalysis(loans);
    const v2023 = v.find((x) => x.vintage === "2023")!;
    assert.equal(v2023.exposure, 8_000_000);
    assert.equal(v2023.criticizedExposure, 8_000_000); // both 2023 loans criticized
    assert.equal(v2023.criticizedPct, 1);
  });

  it("CECL inputs segment by industry with weighted risk", () => {
    const segs = ceclInputs(loans);
    const constr = segs.find((s) => s.segment === "CONSTRUCTION")!;
    // weighted = (5*5M + 4*3M)/8M = (25M+12M)/8M = 4.625
    assert.ok(Math.abs(constr.weightedRiskRating! - (5 * 5_000_000 + 4 * 3_000_000) / 8_000_000) < 1e-9);
    assert.equal(constr.loanCount, 2);
  });
});

describe("PR17 — summary", () => {
  it("summarizePortfolio aggregates the layer", () => {
    const s = summarizePortfolio(loans);
    assert.equal(s.totalExposure, 11_000_000);
    assert.equal(s.loanCount, 4);
    assert.equal(s.industry.buckets[0].key, "CONSTRUCTION");
    assert.equal(s.criticized.criticizedExposure, 8_000_000);
  });

  it("empty portfolio is safe (no divide-by-zero)", () => {
    const s = summarizePortfolio([]);
    assert.equal(s.totalExposure, 0);
    assert.equal(s.industry.hhi, 0);
    assert.equal(s.criticized.criticizedPct, 0);
  });
});
