import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { auditClassicSpread, type AuditInput } from "../spreadAccuracyAudit";
import type { PeriodMaps } from "../../classicSpreadRatios";
import type { FinancialRow } from "../../types";

/** SPEC-CLASSIC-SPREAD-AUDIT-RESOLVER-AWARE-DEDUP-1 — no double-counting a resolved problem. */

function pm(rows: Record<string, Record<string, number | null>>): PeriodMaps {
  const m: PeriodMaps = new Map();
  for (const [period, facts] of Object.entries(rows)) m.set(period, new Map(Object.entries(facts)));
  return m;
}
function row(label: string, values: (number | null)[]): FinancialRow {
  return { label, indent: 0, isBold: true, values, showPct: false };
}
const forRow = (r: ReturnType<typeof auditClassicSpread>, label: string) =>
  r.findings.filter((f) => f.rowLabel === label);

// ── 2024: equity rejected by resolver; stale NET WORTH unreconciled_total suppressed ──────────
describe("2024 TOTAL NET WORTH is not double-counted", () => {
  const byPeriod = pm({
    "2024-12-31": {
      SL_TOTAL_ASSETS: 6_800_000,
      SL_ACCOUNTS_PAYABLE: 71_364, SL_LOANS_FROM_SHAREHOLDERS: 1_930_705, SL_OTHER_LIABILITIES: 284_993,
      SL_RETAINED_EARNINGS: 4_512_938, SL_TOTAL_EQUITY: 6_800_000,
    },
  });
  // rendered rows reflect the RESOLVED overlay (NET WORTH = 4,512,938)
  const balanceSheet: FinancialRow[] = [
    row("TOTAL CURRENT LIABILITIES", [71_364]),
    row("TOTAL NON-CURRENT LIABILITIES", [2_215_698]),
    row("TOTAL LIABILITIES", [2_287_062]),
    row("TOTAL NET WORTH", [4_512_938]),
    row("TOTAL ASSETS", [6_800_000]),
  ];
  const base: AuditInput = { periods: [{ iso: "2024-12-31", label: "2024" }], byPeriod, balanceSheet, incomeStatement: [], cashFlow: [] };

  it("WITHOUT the resolver, the stale footing blocker IS present (proves the duplicate exists)", () => {
    const r = auditClassicSpread(base);
    assert.ok(forRow(r, "TOTAL NET WORTH").some((f) => f.issueType === "unreconciled_total"));
  });

  it("WITH the resolver, only the rejected_source_value remains — no stale unreconciled_total", () => {
    const r = auditClassicSpread({ ...base, resolve: true });
    const nw = forRow(r, "TOTAL NET WORTH");
    assert.equal(nw.length, 1);
    assert.equal(nw[0]!.issueType, "rejected_source_value");
    assert.equal(nw.some((f) => f.issueType === "unreconciled_total"), false);
    assert.equal(r.status, "blocker");
    // 2024 collapses to exactly the one actionable blocker (the rejected equity source)
    assert.equal(r.summary.blockers, 1);
  });
});

// ── 2023 Gross Profit gap: inferred returns/allowances → VERIFY warning, not a GP blocker ──────────
// SPEC-CLASSIC-SPREAD-SOURCE-LINE-MODEL-PARITY-1 #2/#3: gross + COGS + direct GP with no line 1b now
// infers returns/allowances so net sales − COGS == GP (no GP blocker); the inference is surfaced as a
// single VERIFY_SOURCE_LINE warning on Sales / Revenues until line 1b is sourced.
describe("2023 Gross Profit gap is reconciled by inferred returns (VERIFY warning, no GP blocker)", () => {
  it("renders no GROSS PROFIT formula_mismatch and one Sales / Revenues VERIFY warning", () => {
    const r = auditClassicSpread({
      periods: [{ iso: "2023-12-31", label: "2023" }],
      byPeriod: pm({ "2023-12-31": { GROSS_RECEIPTS: 1_000_000, COST_OF_GOODS_SOLD: 600_000, GROSS_PROFIT: 350_000 } }),
      balanceSheet: [], incomeStatement: [row("GROSS PROFIT", [350_000])], cashFlow: [], resolve: true,
    });
    assert.equal(forRow(r, "GROSS PROFIT").filter((f) => f.issueType === "formula_mismatch").length, 0);
    const v = forRow(r, "Sales / Revenues").filter((f) => f.issueType === "formula_mismatch");
    assert.equal(v.length, 1);
    assert.equal(v[0]!.severity, "warning");
  });
});

// ── YTD 2026: keep missing_implied_component, suppress the stale contradictory_components ───────
describe("YTD 2026 keeps the actionable missing implied AR finding", () => {
  it("TCA shows only missing_implied_component (generic contradictory_components suppressed)", () => {
    const r = auditClassicSpread({
      periods: [{ iso: "2026-06-30", label: "2026" }],
      byPeriod: pm({ "2026-06-30": { SL_CASH: 198_693, SL_TOTAL_CURRENT_ASSETS: 3_097_345, SL_TOTAL_ASSETS: 3_501_691, SL_NET_FIXED_ASSETS: 205_654 } }),
      balanceSheet: [row("TOTAL CURRENT ASSETS", [3_097_345]), row("TOTAL ASSETS", [3_501_691])],
      incomeStatement: [], cashFlow: [], resolve: true,
    });
    const tca = forRow(r, "TOTAL CURRENT ASSETS");
    assert.ok(tca.some((f) => f.issueType === "missing_implied_component"));
    assert.equal(tca.some((f) => f.issueType === "contradictory_components"), false);
    assert.equal(r.status, "blocker");
  });
});

// ── 2025: no stale TNCA blocker after resolved render; TCA is a preliminary confirmation ─────────
// BUGFIX-CLASSIC-SPREAD-RESOLVED-VALUE-ACTIONS-1: the coherent component-sum TCA is no longer a hard
// blocker — it is a preliminary/confirmation-needed warning, so the spread is not "unusable".
describe("2025 shows no stale TNCA blocker; the resolved TCA is a preliminary confirmation, not a blocker", () => {
  it("TNCA has no finding; TCA keeps a WARNING-level rejected_source_value and overall status is warning", () => {
    const r = auditClassicSpread({
      periods: [{ iso: "2025-12-31", label: "2025" }],
      byPeriod: pm({ "2025-12-31": { SL_CASH: 739_144, SL_AR_GROSS: 2_393_922, SL_TOTAL_CURRENT_ASSETS: 2_393_922, SL_TOTAL_ASSETS: 3_342_586, SL_NET_FIXED_ASSETS: 209_520 } }),
      balanceSheet: [
        row("Net Accounts Receivable", [2_393_922]),
        row("TOTAL CURRENT ASSETS", [3_133_066]),
        row("TOTAL NON-CURRENT ASSETS", [209_520]),
        row("TOTAL ASSETS", [3_342_586]),
      ],
      incomeStatement: [], cashFlow: [], resolve: true,
    });
    assert.equal(forRow(r, "TOTAL NON-CURRENT ASSETS").length, 0);
    const tca = forRow(r, "TOTAL CURRENT ASSETS").filter((f) => f.issueType === "rejected_source_value");
    assert.equal(tca.length, 1);
    assert.equal(tca[0]!.severity, "warning");
    assert.equal(r.summary.blockers, 0);
    assert.equal(r.status, "warning");
  });
});
