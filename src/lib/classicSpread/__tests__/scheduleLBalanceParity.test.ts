/**
 * BUGFIX-CLASSIC-SPREAD-2022-SCHEDULE-L-BALANCE-PARITY-1 — the rendered TOTAL LIABILITIES & NET WORTH
 * row must equal Total Liabilities + Total Net Worth (the value the line-accuracy audit reconciles
 * against Total Assets), never a silent mirror of Total Assets. When the Schedule L liability/equity
 * detail is incomplete the sheet must visibly NOT balance and the blocker must remain.
 *
 * Uses OmniCare-shaped 2022 fixtures (mortgages 1,503,500 + retained earnings -14,401 vs Total Assets
 * 3,268,740). Values are fixtures, not hard-coded production paths.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  deriveTotalEquity,
  deriveTotalLiabilities,
  deriveTotalNonCurrentLiabilities,
  type PeriodMaps,
} from "../classicSpreadRatios";
import { auditClassicSpread, type SpreadAuditFinding, type SpreadAuditStatement } from "../audit/spreadAccuracyAudit";
import { buildClassicSpreadReviewActions } from "../review/buildReviewActions";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

function pm(rows: Record<string, Record<string, number | null>>): PeriodMaps {
  const m: PeriodMaps = new Map();
  for (const [period, facts] of Object.entries(rows)) m.set(period, new Map(Object.entries(facts)));
  return m;
}
const bsRow = (label: string, value: number | null) => ({ label, indent: 0, isBold: true, values: [value], showPct: false });
const tlnw = (tl: number | null, nw: number | null) => (tl != null && nw != null ? tl + nw : null);

// ── OmniCare 2022: incomplete Schedule L liability/equity side ───────────────────────────────────
describe("2022 Schedule L — incomplete liability/equity detail stays blocked, no fake balance", () => {
  const periods = ["2022-12-31"];
  const byPeriod = pm({
    "2022-12-31": {
      SL_CASH: 684_006, SL_AR_GROSS: 2_466_915, SL_PPE_GROSS: 424_703, SL_ACCUMULATED_DEPRECIATION: 306_884,
      SL_TOTAL_ASSETS: 3_268_740,
      SL_MORTGAGES_NOTES_BONDS: 1_503_500, // non-current debt only (Form 1120 Sched L line 17)
      SL_RETAINED_EARNINGS: -14_401, // negative equity; no capital stock extracted
    },
  });

  it("Total Liabilities = the non-current component (1,503,500), never an assets-minus-equity plug", () => {
    const tl = deriveTotalLiabilities(byPeriod, periods)[0];
    const tncl = deriveTotalNonCurrentLiabilities(byPeriod, periods)[0];
    assert.equal(tl, 1_503_500);
    assert.equal(tncl, 1_503_500); // mortgages map to NON-CURRENT debt, not the grand total
    // the assets-minus-equity plug would be 3,283,141 — must NOT be used
    assert.notEqual(tl, 3_268_740 - -14_401);
  });

  it("TOTAL LIABILITIES & NET WORTH renders 1,489,099 (TL + NW), NOT Total Assets 3,268,740", () => {
    const tl = deriveTotalLiabilities(byPeriod, periods)[0];
    const nw = deriveTotalEquity(byPeriod, periods)[0];
    assert.equal(nw, -14_401);
    const rendered = tlnw(tl, nw);
    assert.equal(rendered, 1_489_099);
    assert.notEqual(rendered, 3_268_740); // does not fake-balance to Total Assets
  });

  it("the audit keeps the 2022 balance-sheet blocker (Liab + NW != Total Assets)", () => {
    const tl = deriveTotalLiabilities(byPeriod, periods)[0]!;
    const nw = deriveTotalEquity(byPeriod, periods)[0]!;
    const r = auditClassicSpread({
      periods: [{ iso: "2022-12-31", label: "2022" }],
      byPeriod,
      balanceSheet: [
        bsRow("TOTAL ASSETS", 3_268_740),
        bsRow("TOTAL LIABILITIES", tl),
        bsRow("TOTAL NET WORTH", nw),
        bsRow("TOTAL LIABILITIES & NET WORTH", tlnw(tl, nw)),
      ],
      incomeStatement: [], cashFlow: [], resolve: true,
    });
    const f = r.findings.find((x) => x.rowLabel === "TOTAL LIABILITIES & NET WORTH" && x.issueType === "unreconciled_total");
    assert.ok(f, "expected an unreconciled_total blocker on TOTAL LIABILITIES & NET WORTH");
    assert.equal(f!.severity, "blocker");
    assert.equal(f!.expectedValue, 3_268_740); // Total Assets
    assert.equal(f!.actualValue, 1_489_099); // Liab + NW (what the rendered row now shows)
    assert.equal(f!.difference, 1_779_641);
  });

  it("the rendered TLNW row EQUALS the audit's actualValue (PDF and audit agree)", () => {
    const tl = deriveTotalLiabilities(byPeriod, periods)[0]!;
    const nw = deriveTotalEquity(byPeriod, periods)[0]!;
    assert.equal(tlnw(tl, nw), 1_489_099); // identical to the audit's `actualValue` above
  });
});

// ── A genuinely-balanced Schedule L: TLNW equals Total Assets because it really reconciles ────────
describe("complete Schedule L — TLNW genuinely reconciles, no blocker", () => {
  const periods = ["2021-12-31"];
  const byPeriod = pm({
    "2021-12-31": {
      SL_TOTAL_ASSETS: 3_268_740,
      SL_TOTAL_LIABILITIES: 1_779_641,
      SL_TOTAL_EQUITY: 1_489_099,
    },
  });
  it("TL + NW = Total Assets → TLNW renders Total Assets as a REAL balance", () => {
    const tl = deriveTotalLiabilities(byPeriod, periods)[0]!;
    const nw = deriveTotalEquity(byPeriod, periods)[0]!;
    assert.equal(tl, 1_779_641);
    assert.equal(nw, 1_489_099);
    assert.equal(tlnw(tl, nw), 3_268_740);
  });
  it("the audit raises NO unreconciled_total blocker on TLNW", () => {
    const r = auditClassicSpread({
      periods: [{ iso: "2021-12-31", label: "2021" }],
      byPeriod,
      balanceSheet: [
        bsRow("TOTAL ASSETS", 3_268_740),
        bsRow("TOTAL LIABILITIES", 1_779_641),
        bsRow("TOTAL NET WORTH", 1_489_099),
        bsRow("TOTAL LIABILITIES & NET WORTH", 3_268_740),
      ],
      incomeStatement: [], cashFlow: [], resolve: true,
    });
    assert.equal(r.findings.find((x) => x.rowLabel === "TOTAL LIABILITIES & NET WORTH" && x.issueType === "unreconciled_total"), undefined);
  });
});

// ── Review-action sync includes the new 2022 blocker ──────────────────────────────────────────────
describe("review-action sync includes the 2022 TLNW blocker", () => {
  it("buildClassicSpreadReviewActions emits the TOTAL LIABILITIES & NET WORTH blocker from the latest audit", () => {
    const finding = (over: Partial<SpreadAuditFinding> & { rowLabel: string; issueType: SpreadAuditFinding["issueType"] }): SpreadAuditFinding => ({
      period: "2022", statement: "balance_sheet" as SpreadAuditStatement,
      expectedValue: null, actualValue: null, difference: null, tolerance: 1,
      sourceFactIds: [], documentIds: [], severity: "blocker", detail: "x", ...over,
    });
    const audit = {
      status: "blocker" as const,
      findings: [
        finding({ rowLabel: "TOTAL LIABILITIES & NET WORTH", issueType: "unreconciled_total", expectedValue: 3_268_740, actualValue: 1_489_099, difference: 1_779_641 }),
        finding({ period: "2026", rowLabel: "TOTAL CURRENT ASSETS", issueType: "missing_implied_component" }),
      ],
      summary: { blockers: 2, warnings: 0, infos: 0, periodsAudited: ["2022", "2026"], footingsChecked: 1, mappedFactKeys: 0, unmappedFactKeys: 0 },
      blockedCells: [], actionSummary: { byPeriod: {}, byDocument: {}, byAction: {}, unresolvedActionCount: 2, actions: [] },
    };
    const actions = buildClassicSpreadReviewActions(audit);
    const a2022 = actions.find((a) => a.periodLabel === "2022" && a.rowLabel === "TOTAL LIABILITIES & NET WORTH");
    assert.ok(a2022, "2022 TLNW blocker must be a review action after sync");
    assert.equal(a2022!.severity, "blocker");
    // both blockers present — the panel cannot show fewer than the audit's blockers after sync
    assert.equal(actions.filter((a) => a.severity === "blocker").length, 2);
  });
});

// ── source guards: renderer + gate wired correctly ───────────────────────────────────────────────
describe("wiring guards", () => {
  it("the loader renders TLNW as Total Liabilities + Net Worth, never values: totalAssets", () => {
    const loader = read("src/lib/classicSpread/classicSpreadLoader.ts");
    assert.match(loader, /const liabilitiesPlusNetWorth = deriveValues/);
    // the detailed-BS TLNW row uses the computed sum, not a Total Assets mirror
    assert.match(loader, /TOTAL LIABILITIES & NET WORTH", indent: 0, isBold: true, values: liabilitiesPlusNetWorth/);
    assert.doesNotMatch(loader, /TOTAL LIABILITIES & NET WORTH", indent: 0, isBold: true, values: totalAssets/);
  });

  it("the gate blanks TOTAL LIABILITIES & NET WORTH when Total Liabilities is suppressed", () => {
    const gate = read("src/lib/classicSpread/certification/certifiedSpreadGateCore.ts");
    assert.match(gate, /rowLabels: \["TOTAL LIABILITIES", "TOTAL NON-CURRENT LIABILITIES", "TOTAL LIABILITIES & NET WORTH"\]/);
  });

  it("the regenerate route syncs review actions from the same audit (panel can't lag the PDF)", () => {
    const route = read("src/app/api/deals/[dealId]/classic-spread/route.ts");
    assert.match(route, /buildClassicSpreadReviewActions\(audit, input\.periods\)/);
    assert.match(route, /syncReviewActions\(\{ dealId, bankId, actions \}\)/);
  });
});
