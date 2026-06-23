import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildResolvedByPeriod } from "../audit/statementTruthResolver";
import {
  deriveTotalEquity,
  deriveTotalLiabilities,
  buildRatioSections,
  type PeriodMaps,
} from "../classicSpreadRatios";
import { auditClassicSpread } from "../audit/spreadAccuracyAudit";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

function pm(rows: Record<string, Record<string, number | null>>): PeriodMaps {
  const m: PeriodMaps = new Map();
  for (const [period, facts] of Object.entries(rows)) m.set(period, new Map(Object.entries(facts)));
  return m;
}
const ov = (m: PeriodMaps, p: string, k: string) => m.get(p)!.get(k) ?? null;
const levRow = (sections: ReturnType<typeof buildRatioSections>, label: string) =>
  sections.find((s) => s.title === "LEVERAGE")!.rows.find((r) => r.label === label)!.values[0];

// ── 2024: rendered equity reflects the resolved value ─────────────────────────────────────────
describe("2024 rendered rows use the resolved overlay", () => {
  const periods = ["2024-12-31"];
  const byPeriod = pm({
    "2024-12-31": {
      SL_TOTAL_ASSETS: 6_800_000,
      SL_ACCOUNTS_PAYABLE: 71_364, SL_LOANS_FROM_SHAREHOLDERS: 1_930_705, SL_OTHER_LIABILITIES: 284_993,
      SL_RETAINED_EARNINGS: 4_512_938, SL_TOTAL_EQUITY: 6_800_000,
    },
  });
  const resolved = buildResolvedByPeriod(byPeriod, periods);

  it("TOTAL NET WORTH renders 4,512,938 (not 6,800,000)", () => {
    assert.equal(ov(resolved, "2024-12-31", "SL_TOTAL_EQUITY"), 4_512_938);
    assert.equal(deriveTotalEquity(resolved, periods)[0], 4_512_938);
  });

  it("TOTAL LIABILITIES renders 2,287,062 and TOTAL LIABILITIES & NET WORTH stays 6,800,000", () => {
    assert.equal(deriveTotalLiabilities(resolved, periods)[0], 2_287_062);
    assert.equal(ov(resolved, "2024-12-31", "SL_TOTAL_ASSETS"), 6_800_000); // TL&NW row renders total assets
  });

  it("ratio rows use the resolved Net Worth / Total Liabilities", () => {
    const sections = buildRatioSections(resolved, periods, [], deriveTotalLiabilities(resolved, periods));
    assert.equal(levRow(sections, "Net Worth"), 4_512_938);
    assert.equal(levRow(sections, "Debt / Worth"), 2_287_062 / 4_512_938);
  });

  it("the original byPeriod is NOT mutated (audit still sees the wrong direct equity)", () => {
    assert.equal(ov(byPeriod, "2024-12-31", "SL_TOTAL_EQUITY"), 6_800_000);
  });

  it("audit on the ORIGINAL facts remains BLOCKER (rejected source)", () => {
    const r = auditClassicSpread({
      periods: [{ iso: "2024-12-31", label: "2024" }], byPeriod,
      balanceSheet: [], incomeStatement: [], cashFlow: [], resolve: true,
    });
    assert.equal(r.status, "blocker");
    assert.ok(r.findings.some((f) => f.issueType === "rejected_source_value"));
  });
});

// ── 2025: TCA/TNCA corrected ──────────────────────────────────────────────────────────────────
describe("2025 rendered current/non-current assets use the resolved overlay", () => {
  const periods = ["2025-12-31"];
  const byPeriod = pm({
    "2025-12-31": {
      SL_CASH: 739_144, SL_AR_GROSS: 2_393_922, SL_TOTAL_CURRENT_ASSETS: 2_393_922,
      SL_TOTAL_ASSETS: 3_342_586, SL_NET_FIXED_ASSETS: 209_520,
    },
  });
  const resolved = buildResolvedByPeriod(byPeriod, periods);

  it("TOTAL CURRENT ASSETS renders 3,133,066 (not 2,393,922)", () => {
    assert.equal(ov(resolved, "2025-12-31", "SL_TOTAL_CURRENT_ASSETS"), 3_133_066);
  });

  it("TOTAL NON-CURRENT ASSETS renders 209,520 (not 948,664)", () => {
    // builder derives TNCA = Total Assets − Total Current Assets
    const ta = ov(resolved, "2025-12-31", "SL_TOTAL_ASSETS")!;
    const tca = ov(resolved, "2025-12-31", "SL_TOTAL_CURRENT_ASSETS")!;
    assert.equal(ta - tca, 209_520);
  });
});

// ── YTD 2026: do not invent the missing AR ────────────────────────────────────────────────────
describe("YTD 2026 does not invent a missing current asset", () => {
  it("keeps the direct TCA unchanged (no correction)", () => {
    const periods = ["2026-06-30"];
    const byPeriod = pm({
      "2026-06-30": { SL_CASH: 198_693, SL_TOTAL_CURRENT_ASSETS: 3_097_345, SL_TOTAL_ASSETS: 3_501_691, SL_NET_FIXED_ASSETS: 205_654 },
    });
    const resolved = buildResolvedByPeriod(byPeriod, periods);
    assert.equal(ov(resolved, "2026-06-30", "SL_TOTAL_CURRENT_ASSETS"), 3_097_345); // unchanged
  });
});

describe("loader wiring", () => {
  it("the loader builds rendered rows from the resolved overlay", () => {
    const loader = read("src/lib/classicSpread/classicSpreadLoader.ts");
    assert.match(loader, /const resolvedByPeriod = buildResolvedByPeriod\(byPeriod, periods\)/);
    assert.match(loader, /buildBalanceSheetRows\(resolvedByPeriod, periods\)/);
    assert.match(loader, /buildExecutiveSummary\(resolvedByPeriod, periods\)/);
    assert.match(loader, /buildRatioSections\(resolvedByPeriod, periods, cashFlowRows, totalLiabilitiesForRatios\)/);
    assert.match(loader, /buildCashFlowRows\(resolvedByPeriod, periods\)/);
    // audit keeps the ORIGINAL facts
    assert.match(loader, /auditClassicSpread\(\{\s*periods: auditPeriods,\s*byPeriod,/);
  });
});
