import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildRatioSections,
  deriveTotalLiabilities,
  deriveTotalEquity,
  isLiabilityRatioAvailable,
  type PeriodMaps,
} from "../classicSpreadRatios";

/**
 * BUGFIX (classic-spread render consistency, Patch A).
 *
 * Leverage/growth ratios must honor the SAME Total Liabilities value the visible TOTAL LIABILITIES
 * row renders. When that value is unavailable (null, or 0 — which fmtNumber renders as a blank
 * em-dash), the dependent ratio cell must be blank rather than a false 0.00 / -100%.
 */

function periodMaps(rows: Record<string, Record<string, number | null>>): PeriodMaps {
  const m: PeriodMaps = new Map();
  for (const [period, facts] of Object.entries(rows)) {
    m.set(period, new Map(Object.entries(facts)));
  }
  return m;
}

const lev = (sections: ReturnType<typeof buildRatioSections>, label: string) =>
  sections.find((s) => s.title === "LEVERAGE")!.rows.find((r) => r.label === label)!.values;
const growth = (sections: ReturnType<typeof buildRatioSections>, label: string) =>
  sections.find((s) => s.title === "GROWTH")!.rows.find((r) => r.label === label)!.values;

describe("isLiabilityRatioAvailable mirrors the visible TOTAL LIABILITIES blank rule", () => {
  it("null and 0 are unavailable; positive values are available", () => {
    assert.equal(isLiabilityRatioAvailable(null), false);
    assert.equal(isLiabilityRatioAvailable(0), false);
    assert.equal(isLiabilityRatioAvailable(400), true);
  });
});

describe("deriveTotalLiabilities matches the visible TOTAL LIABILITIES source/rule", () => {
  const periods = ["2023-12-31", "2024-12-31"];
  const byPeriod = periodMaps({
    "2023-12-31": { SL_TOTAL_ASSETS: 1000, SL_TOTAL_EQUITY: 600 }, // TL = 400
    "2024-12-31": { SL_TOTAL_ASSETS: 6_800_000, SL_TOTAL_EQUITY: 6_800_000 }, // TL = 0 (OmniCare 2024)
  });

  it("derives assets − equity, never falling back to zero", () => {
    assert.deepEqual(deriveTotalLiabilities(byPeriod, periods), [400, 0]);
    assert.deepEqual(deriveTotalEquity(byPeriod, periods), [600, 6_800_000]);
  });

  it("a period with neither stored liabilities nor (assets,equity) is null", () => {
    const sparse = periodMaps({ "2024-12-31": { SL_TOTAL_ASSETS: 100 } }); // no equity
    assert.deepEqual(deriveTotalLiabilities(sparse, ["2024-12-31"]), [null]);
  });

  it("a directly stored SL_TOTAL_LIABILITIES wins over the derivation", () => {
    const direct = periodMaps({ "2024-12-31": { SL_TOTAL_ASSETS: 6_800_000, SL_TOTAL_EQUITY: 6_800_000, SL_TOTAL_LIABILITIES: 2_287_062 } });
    assert.deepEqual(deriveTotalLiabilities(direct, ["2024-12-31"]), [2_287_062]);
  });
});

describe("liability-derived ratios are blank when the visible Total Liabilities is blank", () => {
  const periods = ["2023-12-31", "2024-12-31"];
  const byPeriod = periodMaps({
    "2023-12-31": { SL_TOTAL_ASSETS: 1000, SL_TOTAL_EQUITY: 600 }, // TL = 400 → available
    "2024-12-31": { SL_TOTAL_ASSETS: 6_800_000, SL_TOTAL_EQUITY: 6_800_000 }, // TL = 0 → blank
  });
  const tlForRatios = deriveTotalLiabilities(byPeriod, periods);
  const sections = buildRatioSections(byPeriod, periods, [], tlForRatios);

  it("Debt / Worth: 2023 computes, 2024 (blank TL) is null — not 0.00", () => {
    const v = lev(sections, "Debt / Worth");
    assert.equal(v[0], 400 / 600);
    assert.equal(v[1], null);
  });

  it("Debt / Tangible Net Worth: 2024 is null", () => {
    assert.equal(lev(sections, "Debt / Tangible Net Worth")[1], null);
  });

  it("Total Liabilities / Total Assets: 2024 is null", () => {
    assert.equal(lev(sections, "Total Liabilities / Total Assets")[1], null);
  });

  it("Total Liabilities Growth %: blank when either endpoint TL is unavailable", () => {
    // 2024 endpoint TL = 0 → unavailable → growth cell null.
    assert.equal(growth(sections, "Total Liabilities Growth %")[1], null);
  });

  it("a non-liability leverage row (Net Worth) is untouched", () => {
    assert.equal(lev(sections, "Net Worth")[1], 6_800_000);
  });
});

describe("liability-derived ratios still render when Total Liabilities is available", () => {
  const periods = ["2022-12-31", "2023-12-31"];
  const byPeriod = periodMaps({
    "2022-12-31": { SL_TOTAL_ASSETS: 1000, SL_TOTAL_EQUITY: 600 }, // TL = 400
    "2023-12-31": { SL_TOTAL_ASSETS: 1500, SL_TOTAL_EQUITY: 700 }, // TL = 800
  });
  const tlForRatios = deriveTotalLiabilities(byPeriod, periods);
  const sections = buildRatioSections(byPeriod, periods, [], tlForRatios);

  it("Debt / Worth and TL / TA compute for both periods", () => {
    assert.deepEqual(lev(sections, "Debt / Worth"), [400 / 600, 800 / 700]);
    assert.deepEqual(lev(sections, "Total Liabilities / Total Assets"), [400 / 1000, 800 / 1500]);
  });

  it("Total Liabilities Growth % computes when both endpoints are available", () => {
    // (800 − 400) / 400 * 100 = 100%
    assert.equal(growth(sections, "Total Liabilities Growth %")[1], 100);
  });
});
