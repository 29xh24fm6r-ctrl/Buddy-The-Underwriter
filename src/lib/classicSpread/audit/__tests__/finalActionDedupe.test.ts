import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { auditClassicSpread, type AuditInput } from "../spreadAccuracyAudit";
import type { PeriodMaps } from "../../classicSpreadRatios";
import type { FinancialRow } from "../../types";

/** SPEC-CLASSIC-SPREAD-V12-FINAL-ACTION-DEDUPE-1 — TNCA unreconciled folds into the implied-AR blocker. */

function pm(rows: Record<string, Record<string, number | null>>): PeriodMaps {
  const m: PeriodMaps = new Map();
  for (const [period, facts] of Object.entries(rows)) m.set(period, new Map(Object.entries(facts)));
  return m;
}
function row(label: string, values: (number | null)[]): FinancialRow {
  return { label, indent: 0, isBold: true, values, showPct: false };
}
const findIn = (r: ReturnType<typeof auditClassicSpread>, period: string, label: string) =>
  r.findings.filter((f) => f.period === period && f.rowLabel === label);

describe("YTD 2026 TNCA unreconciled_total is downgraded to a warning", () => {
  const input: AuditInput = {
    periods: [{ iso: "2026-06-30", label: "2026" }],
    byPeriod: pm({ "2026-06-30": { SL_CASH: 198_693, SL_TOTAL_CURRENT_ASSETS: 3_097_345, SL_TOTAL_ASSETS: 3_501_691, SL_PPE_GROSS: 205_654 } }),
    balanceSheet: [
      row("TOTAL CURRENT ASSETS", [3_097_345]),
      row("TOTAL NON-CURRENT ASSETS", [404_346]), // Total Assets − Total Current Assets
      row("TOTAL ASSETS", [3_501_691]),
    ],
    incomeStatement: [], cashFlow: [], resolve: true,
  };
  const r = auditClassicSpread(input);

  it("keeps the actionable missing_implied_component blocker on TOTAL CURRENT ASSETS", () => {
    const tca = findIn(r, "2026", "TOTAL CURRENT ASSETS");
    assert.ok(tca.some((f) => f.issueType === "missing_implied_component" && f.severity === "blocker"));
  });

  it("downgrades the TNCA unreconciled_total to a warning (no longer a blocker)", () => {
    const tnca = findIn(r, "2026", "TOTAL NON-CURRENT ASSETS");
    const u = tnca.find((f) => f.issueType === "unreconciled_total");
    assert.ok(u);
    assert.equal(u!.severity, "warning");
  });

  it("the only remaining blocker for 2026 is the implied current-asset finding", () => {
    const blockers2026 = r.findings.filter((f) => f.period === "2026" && f.severity === "blocker");
    assert.equal(blockers2026.length, 1);
    assert.equal(blockers2026[0]!.issueType, "missing_implied_component");
    assert.equal(r.status, "blocker");
  });
});

describe("unrelated TNCA blockers in other periods are NOT suppressed", () => {
  it("a TNCA unreconciled in a period WITHOUT an implied-TCA finding stays a blocker", () => {
    const input: AuditInput = {
      periods: [
        { iso: "2026-06-30", label: "2026" },
        { iso: "2027-06-30", label: "2027" },
      ],
      byPeriod: pm({
        // 2026: implied TCA → its TNCA gets downgraded
        "2026-06-30": { SL_CASH: 198_693, SL_TOTAL_CURRENT_ASSETS: 3_097_345, SL_TOTAL_ASSETS: 3_501_691, SL_PPE_GROSS: 205_654 },
        // 2027: components fully present, but rendered TNCA disagrees → a REAL TNCA blocker
        "2027-06-30": { SL_CASH: 100_000, SL_TOTAL_ASSETS: 1_000_000, SL_PPE_GROSS: 200_000 },
      }),
      balanceSheet: [
        row("TOTAL CURRENT ASSETS", [3_097_345, 100_000]),
        row("TOTAL NON-CURRENT ASSETS", [404_346, 900_000]), // 2027 rendered 900k vs component 200k
        row("TOTAL ASSETS", [3_501_691, 1_000_000]),
      ],
      incomeStatement: [], cashFlow: [], resolve: true,
    };
    const r = auditClassicSpread(input);
    const tnca2026 = r.findings.find((f) => f.period === "2026" && f.rowLabel === "TOTAL NON-CURRENT ASSETS" && f.issueType === "unreconciled_total");
    const tnca2027 = r.findings.find((f) => f.period === "2027" && f.rowLabel === "TOTAL NON-CURRENT ASSETS" && f.issueType === "unreconciled_total");
    assert.equal(tnca2026!.severity, "warning"); // downgraded (implied TCA same period)
    assert.ok(tnca2027); // 2027 has no implied-TCA finding
    assert.equal(tnca2027!.severity, "blocker"); // untouched
  });
});
