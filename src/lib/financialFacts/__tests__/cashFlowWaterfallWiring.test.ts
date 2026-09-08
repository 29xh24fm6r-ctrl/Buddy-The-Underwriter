import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  selectCompleteFiscalYearPeriod,
  buildWaterfallInputFromFacts,
  type PeriodFact,
} from "../cashFlowWaterfallInput";
import { computeCashFlowWaterfall } from "@/lib/spreads/cashFlowWaterfall";

/**
 * SPEC-CANONICAL-NCADS-WATERFALL-WIRING-1 (Step 1).
 */

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

describe("complete-fiscal-year period selection", () => {
  it("picks the FY-end (2024-12-31) over an interim Q1 (2026-03-31) — the OmniCare bug", () => {
    const facts: PeriodFact[] = [
      { fact_key: "ORDINARY_BUSINESS_INCOME", fact_value_num: 200925, fact_period_end: "2024-12-31" },
      { fact_key: "NET_INCOME", fact_value_num: 205112, fact_period_end: "2026-03-31" },
    ];
    assert.equal(selectCompleteFiscalYearPeriod(facts), "2024-12-31");
  });
  it("returns null when only interim periods exist (no fake precision)", () => {
    const facts: PeriodFact[] = [{ fact_key: "NET_INCOME", fact_value_num: 205112, fact_period_end: "2026-03-31" }];
    assert.equal(selectCompleteFiscalYearPeriod(facts), null);
  });
  it("picks the most recent complete fiscal year", () => {
    const facts: PeriodFact[] = [
      { fact_key: "TAXABLE_INCOME", fact_value_num: 100, fact_period_end: "2022-12-31" },
      { fact_key: "TAXABLE_INCOME", fact_value_num: 200, fact_period_end: "2024-12-31" },
      { fact_key: "TAXABLE_INCOME", fact_value_num: 150, fact_period_end: "2023-12-31" },
    ];
    assert.equal(selectCompleteFiscalYearPeriod(facts), "2024-12-31");
  });
});

describe("waterfall input from OmniCare-shaped FY2024 facts", () => {
  it("pass-through (OBI present): NCADS = base + D&A, no tax, officer comp within market", () => {
    const built = buildWaterfallInputFromFacts({
      ORDINARY_BUSINESS_INCOME: 200925,
      DEPRECIATION: 210207,
      INTEREST_EXPENSE: 0,
      OFFICER_COMPENSATION: 310000,
      GROSS_RECEIPTS: 28767069,
    });
    assert.equal(built.input.netIncomeBase, 200925);
    assert.equal(built.input.isPassThrough, true);
    assert.equal(built.input.addbackExcessCompensation, null); // 310k << 40% of $28.8M
    const wf = computeCashFlowWaterfall(built.input);
    assert.equal(wf.cfNcads, 200925 + 210207); // 411,132 — institutional annual NCADS
  });

  it("Form 1120 C-corp (TAXABLE_INCOME, no OBI): tax provision subtracted", () => {
    const built = buildWaterfallInputFromFacts({
      TAXABLE_INCOME: 200000,
      TOTAL_TAX: 42000,
      DEPRECIATION: 50000,
      OFFICER_COMPENSATION: 20000,
      GROSS_RECEIPTS: 100000,
    });
    assert.equal(built.form, "C_CORP");
    assert.equal(built.input.isPassThrough, false);
    assert.equal(built.input.normalizedTaxProvision, 42000);
    const wf = computeCashFlowWaterfall(built.input);
    // EBITDA = 200,000 + 50,000; − tax 42,000 = 208,000
    assert.equal(wf.cfNcads, 200000 + 50000 - 42000);
  });

  it("no income base → null netIncomeBase (writer emits a labeled diagnostic, not fake precision)", () => {
    const built = buildWaterfallInputFromFacts({ DEPRECIATION: 50000 });
    // netIncomeBase is null → the writer guards on this and skips (NCADS_NO_INCOME_BASE),
    // never persisting a CF_NCADS fabricated from addbacks alone.
    assert.equal(built.input.netIncomeBase, null);
    assert.equal(built.provenance.base_value, null);
    // Guard is enforced in computeCashFlowWaterfallFacts (source-checked below).
    const writer = read("src/lib/financialFacts/computeCashFlowWaterfallFacts.ts");
    assert.match(writer, /netIncomeBase === null/);
    assert.match(writer, /NCADS_NO_INCOME_BASE/);
  });

  it("provenance carries base, addbacks, QoE, owner-benefit, tax/capex", () => {
    const built = buildWaterfallInputFromFacts({ ORDINARY_BUSINESS_INCOME: 200925, DEPRECIATION: 210207, GROSS_RECEIPTS: 28767069, OFFICER_COMPENSATION: 310000 });
    const p = built.provenance;
    assert.equal(p.base_key, "ORDINARY_BUSINESS_INCOME");
    assert.equal(p.base_value, 200925);
    assert.equal(p.noncash_addbacks, 210207);
    assert.equal(p.is_pass_through, true);
    assert.ok("qoe_net" in p && "owner_benefit_excess_comp" in p && "tax_provision" in p && "maintenance_capex" in p);
  });
});

describe("aggregator prefers waterfall NCADS + demotes crude fallbacks", () => {
  const agg = read("src/lib/financialFacts/runCashFlowAggregator.ts");
  it("reads CF_NCADS and overrides with a WATERFALL source", () => {
    assert.match(agg, /fact_key",\s*"CF_NCADS"|"CF_NCADS"/);
    assert.match(agg, /ncadsSource\s*=\s*"WATERFALL"/);
  });
  it("crude C-corp addback is gated so it cannot fire when waterfall NCADS exists", () => {
    assert.match(agg, /ncadsSource !== "WATERFALL"\s*&&\s*\(ncads === null/);
  });
  it("does not write a competing CASH_FLOW_AVAILABLE when source is WATERFALL", () => {
    assert.match(agg, /ncadsSource === "WATERFALL"\s*\?\s*\[\]/);
  });
});

describe("writer is wired into the canonical chain before the aggregator", () => {
  it("spreadsProcessor calls computeCashFlowWaterfallFacts before runCashFlowAggregator", () => {
    const proc = read("src/lib/jobs/processors/spreadsProcessor.ts");
    const wfIdx = proc.indexOf("computeCashFlowWaterfallFacts");
    const aggIdx = proc.indexOf("runCashFlowAggregator");
    assert.ok(wfIdx > 0 && aggIdx > 0 && wfIdx < aggIdx, "waterfall writer must run before the aggregator");
  });
  it("registry: computeCashFlowWaterfallFacts runsBefore runCashFlowAggregator", () => {
    const reg = read("src/lib/financialFacts/canonicalWriters.ts");
    const block = reg.slice(reg.indexOf("computeCashFlowWaterfallFacts: {"), reg.indexOf("computeTotalDebtService: {"));
    assert.match(block, /runsAfter:\s*\["computeBusinessEbitdaFacts",\s*"analyzeOfficerCompFacts"\]/);
    assert.match(block, /runsBefore:\s*\["runCashFlowAggregator"\]/);
    assert.match(block, /ownedFactKeys:\s*\["CF_NCADS",\s*"CASH_FLOW_AVAILABLE"\]/);
  });
});

// ── SPEC-NCADS-NO-FUTURE-FISCAL-YEAR-1 ────────────────────────────────────
// A YTD interim P&L whose period could not be resolved falls back to
// FY<doc_year> (…-12-31). When that year has not ended yet it is NOT a
// complete fiscal year and must never become the NCADS basis.
it("selectCompleteFiscalYearPeriod: ignores a fiscal year that has not ended yet", () => {
  const facts = [
    { fact_key: "NET_INCOME", fact_value_num: 35746.75, fact_period_end: "2026-12-31" },
    { fact_key: "NET_INCOME", fact_value_num: 106319, fact_period_end: "2025-12-31" },
  ];
  assert.equal(selectCompleteFiscalYearPeriod(facts, { today: "2026-09-02" }), "2025-12-31");
  // Once the year has actually closed the same fact is eligible.
  assert.equal(selectCompleteFiscalYearPeriod(facts, { today: "2027-01-15" }), "2026-12-31");
});

it("buildWaterfallInputFromFacts: owner-occupied purchase rent add-back flows into Step 5", () => {
  const factMap = {
    ORDINARY_BUSINESS_INCOME: 133679,
    DEPRECIATION: 4562,
    INTEREST_EXPENSE: 11553,
    RENT_EXPENSE: 86000,
  } as Record<string, number | null>;
  const withRent = buildWaterfallInputFromFacts(factMap, undefined, {
    rentAddback: { amount: 86000, reason: "owner-occupied purchase" },
  });
  assert.equal(withRent.input.addbackRentNormalization, 86000);
  assert.equal(withRent.provenance.rent_addback, 86000);
  assert.equal(withRent.provenance.rent_addback_note, "owner-occupied purchase");

  const without = buildWaterfallInputFromFacts(factMap);
  assert.equal(without.input.addbackRentNormalization, null);
  assert.equal(without.provenance.rent_addback, null);
});
