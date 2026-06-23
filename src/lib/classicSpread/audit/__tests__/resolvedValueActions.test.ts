/**
 * BUGFIX-CLASSIC-SPREAD-RESOLVED-VALUE-ACTIONS-1 — the Spread Review Actions and certification audit
 * must recognise resolved classic-spread values instead of presenting them as unresolved blockers,
 * WITHOUT masking real source-detail gaps.
 *
 *   - 2025 TOTAL CURRENT ASSETS: direct = AR only; resolved = Cash + AR (coherent component sum the
 *     row already renders) → preliminary/confirmation, NOT a blocker review action.
 *   - YTD 2026 TOTAL CURRENT ASSETS: when the source-line resolver remapped AR, the row shows AR and
 *     the blocker clears; when AR is genuinely absent, REQUEST_SOURCE_DETAIL remains.
 *   - 2024 TOTAL NET WORTH (retained-earnings arbitration) and 2023 GROSS PROFIT (VERIFY) semantics
 *     are preserved.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { auditClassicSpread, type AuditInput } from "../spreadAccuracyAudit";
import { buildClassicSpreadReviewActions } from "../../review/buildReviewActions";
import { resolveBalanceSheetSourceLines, type SourceLineFact } from "../balanceSheetSourceLineResolver";
import type { PeriodMaps } from "../../classicSpreadRatios";

const pm = (obj: Record<string, Record<string, number | null>>): PeriodMaps => {
  const m: PeriodMaps = new Map();
  for (const [p, kv] of Object.entries(obj)) m.set(p, new Map(Object.entries(kv)));
  return m;
};
const row = (label: string, values: (number | null)[]) => ({ label, indent: 0, isBold: false, values, showPct: false });
const reviewFor = (audit: ReturnType<typeof auditClassicSpread>, rowLabel: string) =>
  buildClassicSpreadReviewActions(audit).filter((a) => a.rowLabel === rowLabel);

// ── 2025 TCA — coherent component sum is not an unresolved blocker action ────────────────────────
describe("2025 TOTAL CURRENT ASSETS resolved by component sum", () => {
  const audit = auditClassicSpread({
    periods: [{ iso: "2025-12-31", label: "2025" }],
    byPeriod: pm({ "2025-12-31": { SL_CASH: 739_144, SL_AR_GROSS: 2_393_922, SL_TOTAL_CURRENT_ASSETS: 2_393_922, SL_TOTAL_ASSETS: 3_342_586, SL_NET_FIXED_ASSETS: 209_520 } }),
    balanceSheet: [
      row("Net Accounts Receivable", [2_393_922]),
      row("TOTAL CURRENT ASSETS", [3_133_066]), // resolved value already rendered
      row("TOTAL NON-CURRENT ASSETS", [209_520]),
      row("TOTAL ASSETS", [3_342_586]),
    ],
    incomeStatement: [], cashFlow: [], resolve: true,
  });

  it("does not produce a blocker review action for TOTAL CURRENT ASSETS", () => {
    assert.equal(reviewFor(audit, "TOTAL CURRENT ASSETS").length, 0);
    assert.equal(audit.summary.blockers, 0);
    assert.equal(audit.status, "warning"); // preliminary confirmation, not unusable
  });
});

// ── YTD 2026 — branch A: AR remapped by source line → row shows AR, blocker clears ──────────────
describe("YTD 2026 with source-line-remapped Accounts Receivable", () => {
  const f = (k: string, v: number, snippet: string): SourceLineFact => ({
    fact_key: k, fact_value_num: v, fact_period_end: "2026-06-30", confidence: 0.5,
    provenance: { citations: [{ page: null, snippet }] },
  });
  // raw facts: an AR line mislabeled as Total Current Assets, plus cash.
  const raw = [f("SL_CASH", 198_693, "Cash"), f("SL_TOTAL_CURRENT_ASSETS", 3_097_345, "Accounts receivable")];
  const { facts: resolved } = resolveBalanceSheetSourceLines(raw);

  it("the source-line resolver moves AR off the TCA key", () => {
    assert.ok(resolved.some((x) => x.fact_key === "SL_AR_GROSS" && x.fact_value_num === 3_097_345));
    assert.ok(!resolved.some((x) => x.fact_key === "SL_TOTAL_CURRENT_ASSETS"));
  });

  it("the audit shows AR and no TCA source-detail blocker", () => {
    const byPeriod = pm({ "2026-06-30": Object.fromEntries(resolved.map((x) => [x.fact_key, x.fact_value_num])) });
    const audit = auditClassicSpread({
      periods: [{ iso: "2026-06-30", label: "2026" }],
      byPeriod,
      balanceSheet: [
        row("Net Accounts Receivable", [3_097_345]),
        row("TOTAL CURRENT ASSETS", [3_296_038]), // cash + AR
      ],
      incomeStatement: [], cashFlow: [], resolve: true,
    });
    assert.equal(reviewFor(audit, "TOTAL CURRENT ASSETS").length, 0);
  });
});

// ── YTD 2026 — branch B: AR genuinely absent → REQUEST_SOURCE_DETAIL remains ────────────────────
describe("YTD 2026 with AR genuinely absent", () => {
  const audit = auditClassicSpread({
    periods: [{ iso: "2026-06-30", label: "2026" }],
    byPeriod: pm({ "2026-06-30": { SL_CASH: 198_693, SL_TOTAL_CURRENT_ASSETS: 3_097_345, SL_TOTAL_ASSETS: 3_501_691, SL_NET_FIXED_ASSETS: 205_654 } }),
    balanceSheet: [row("TOTAL CURRENT ASSETS", [3_097_345]), row("TOTAL ASSETS", [3_501_691])],
    incomeStatement: [], cashFlow: [], resolve: true,
  });

  it("keeps a REQUEST_SOURCE_DETAIL blocker for the genuinely missing current asset", () => {
    const actions = reviewFor(audit, "TOTAL CURRENT ASSETS");
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.issueType, "missing_implied_component");
    assert.equal(actions[0]!.actionType, "REQUEST_SOURCE_DETAIL");
  });
});

// ── preserved semantics: 2024 TOTAL NET WORTH stays a confirmation blocker ──────────────────────
describe("2024 TOTAL NET WORTH confirmation semantics preserved", () => {
  const audit = auditClassicSpread({
    periods: [{ iso: "2024-12-31", label: "2024" }],
    byPeriod: pm({ "2024-12-31": { SL_TOTAL_ASSETS: 6_800_000, SL_ACCOUNTS_PAYABLE: 71_364, SL_LOANS_FROM_SHAREHOLDERS: 1_930_705, SL_OTHER_LIABILITIES: 284_993, SL_RETAINED_EARNINGS: 4_512_938, SL_TOTAL_EQUITY: 6_800_000 } }),
    balanceSheet: [row("TOTAL NET WORTH", [4_512_938]), row("TOTAL LIABILITIES", [2_287_062]), row("TOTAL ASSETS", [6_800_000])],
    incomeStatement: [], cashFlow: [], resolve: true,
  });

  it("still surfaces a CONFIRM_RESOLVED_VALUE blocker for the rejected direct equity", () => {
    const actions = reviewFor(audit, "TOTAL NET WORTH");
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.issueType, "rejected_source_value");
    assert.equal(actions[0]!.actionType, "CONFIRM_RESOLVED_VALUE");
  });
});
