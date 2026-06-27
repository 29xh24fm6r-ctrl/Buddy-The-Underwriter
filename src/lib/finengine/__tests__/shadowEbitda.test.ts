import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSpreadInputsByPeriod, type AdapterFactRow } from "@/lib/finengine/shadow/dealInputAdapter";
import {
  goldenConservativeEbitda,
  goldenOwnerCompExcess,
  goldenS179Acceleration,
  LEGACY_OMNICARE_EBITDA_BUG,
} from "@/lib/finengine/shadow/ebitdaGoldenSet";
import { runEbitdaShadow } from "@/lib/finengine/shadow/runEbitdaShadow";
import { compareProducers } from "@/lib/finengine/shadow/reconcile";

// OmniCare-like C-corp fixture (3× Form 1120). Worst year's raw taxable income is
// the legacy bug value -457,567; add-backs lift real EBITDA well above it.
const rows: AdapterFactRow[] = [
  // 2022 (worst year — the bug lives here)
  { fact_key: "TAXABLE_INCOME", fact_value_num: -457567, fact_period_end: "2022-12-31", owner_type: "borrower", is_superseded: false },
  { fact_key: "INTEREST_EXPENSE", fact_value_num: 395000, fact_period_end: "2022-12-31", owner_type: "borrower", is_superseded: false },
  { fact_key: "DEPRECIATION", fact_value_num: 210000, fact_period_end: "2022-12-31", owner_type: "borrower", is_superseded: false },
  { fact_key: "OFFICER_COMPENSATION", fact_value_num: 325000, fact_period_end: "2022-12-31", owner_type: "borrower", is_superseded: false },
  { fact_key: "GROSS_RECEIPTS", fact_value_num: 2000000, fact_period_end: "2022-12-31", owner_type: "borrower", is_superseded: false },
  { fact_key: "EBITDA", fact_value_num: -457567, fact_period_end: "2022-12-31", owner_type: "borrower", is_superseded: true }, // legacy bug, superseded
  // 2021
  { fact_key: "TAXABLE_INCOME", fact_value_num: 300000, fact_period_end: "2021-12-31", owner_type: "borrower", is_superseded: false },
  { fact_key: "INTEREST_EXPENSE", fact_value_num: 200000, fact_period_end: "2021-12-31", owner_type: "borrower", is_superseded: false },
  { fact_key: "DEPRECIATION", fact_value_num: 120000, fact_period_end: "2021-12-31", owner_type: "borrower", is_superseded: false },
  // 2020 — missing INTEREST_EXPENSE (real quirk → warning, treated as 0)
  { fact_key: "TAXABLE_INCOME", fact_value_num: 250000, fact_period_end: "2020-12-31", owner_type: "borrower", is_superseded: false },
  { fact_key: "DEPRECIATION", fact_value_num: 61700, fact_period_end: "2020-12-31", owner_type: "borrower", is_superseded: false },
  // TTM aggregate sentinel
  { fact_key: "TAXABLE_INCOME", fact_value_num: 100000, fact_period_end: "1900-01-01", owner_type: "borrower", is_superseded: false },
  { fact_key: "DEPRECIATION", fact_value_num: 130000, fact_period_end: "1900-01-01", owner_type: "borrower", is_superseded: false },
];

describe("deal-input adapter", () => {
  it("produces one SpreadInputs per (owner, period) with the aggregate last", () => {
    const periods = buildSpreadInputsByPeriod(rows);
    assert.equal(periods.length, 4);
    assert.deepEqual(periods.map((p) => p.fiscalPeriodEnd), ["2020-12-31", "2021-12-31", "2022-12-31", "1900-01-01"]);
    assert.equal(periods.at(-1)!.isAggregate, true);
  });
  it("warns on a period missing INTEREST_EXPENSE (treated as 0)", () => {
    const p2020 = buildSpreadInputsByPeriod(rows).find((p) => p.fiscalPeriodEnd === "2020-12-31")!;
    assert.ok(p2020.warnings.some((w) => /missing INTEREST_EXPENSE/.test(w)));
    assert.equal(p2020.inputs.facts["INTEREST_EXPENSE"], undefined);
  });
});

describe("independent golden derivation (§3)", () => {
  it("C-corp EBITDA = taxable income + interest + D&A (pre-tax base, taxes NOT added back)", () => {
    const g = goldenConservativeEbitda({ TAXABLE_INCOME: -457567, INTEREST_EXPENSE: 395000, DEPRECIATION: 210000 });
    assert.equal(g.baseKey, "TAXABLE_INCOME");
    assert.equal(g.conservativeEbitda, -457567 + 395000 + 210000); // 147,433
    assert.notEqual(g.conservativeEbitda, LEGACY_OMNICARE_EBITDA_BUG);
  });
  it("owner comp: excess only when over-paid; §179 not a full add-back", () => {
    assert.equal(goldenOwnerCompExcess({ OFFICER_COMPENSATION: 1000000, GROSS_RECEIPTS: 2000000 }).amount, 1000000 - 200000); // >40% -> excess over 10%
    assert.equal(goldenOwnerCompExcess({ OFFICER_COMPENSATION: 325000, GROSS_RECEIPTS: 2000000 }).amount, 0); // within range
    assert.equal(goldenS179Acceleration({ SECTION_179_EXPENSE: 250000 }), 0); // no straight-line baseline -> not added back
    assert.equal(goldenS179Acceleration({ SECTION_179_EXPENSE: 250000, STRAIGHT_LINE_DEPRECIATION: 50000 }), 200000);
  });
});

describe("EBITDA shadow run — the C-corp-fix proof (V2)", () => {
  const result = runEbitdaShadow("80fe6f7a-5c68-4f02-8bcf-933f246a9fc5", rows);

  it("every period's engine EBITDA != the -457,567 bug and equals the independent golden", () => {
    for (const p of result.periods) {
      assert.notEqual(p.engineEbitda, LEGACY_OMNICARE_EBITDA_BUG, `period ${p.fiscalPeriodEnd} still produces the bug`);
      assert.equal(p.engineEbitda, p.goldenEbitda, `period ${p.fiscalPeriodEnd}: engine ${p.engineEbitda} != golden ${p.goldenEbitda}`);
    }
  });
  it("worst year (2022): legacy -457,567 -> engine +147,433 (interest + D&A restored)", () => {
    const y = result.periods.find((p) => p.fiscalPeriodEnd === "2022-12-31")!;
    assert.equal(y.legacyEbitda, -457567);
    assert.equal(y.engineEbitda, 147433);
  });
  it("report classifies the fix as INTENDED, never UNEXPECTED; cutover not blocked", () => {
    assert.equal(result.report.unexpected, 0);
    assert.ok(result.report.intended > 0);
    assert.equal(result.report.cutoverBlocked, false);
  });
});

describe("classifier correctly flags the bug vs the golden (harness integrity)", () => {
  const golden = [{ dealId: "d", factKey: "EBITDA", ownerType: "borrower", fiscalPeriodEnd: "2022-12-31", expectedNewValue: 147433, rationale: "x", spec: "y" }];
  it("a value equal to the -457,567 bug is UNEXPECTED (not the golden)", () => {
    const r = compareProducers(
      [{ dealId: "d", factKey: "EBITDA", ownerType: "borrower", fiscalPeriodEnd: "2022-12-31", value: 999 }],
      [{ dealId: "d", factKey: "EBITDA", ownerType: "borrower", fiscalPeriodEnd: "2022-12-31", value: -457567 }],
      golden,
    );
    assert.equal(r.unexpected, 1);
    assert.equal(r.cutoverBlocked, true);
  });
  it("an exact legacy match is ZERO", () => {
    const r = compareProducers(
      [{ dealId: "d", factKey: "EBITDA", ownerType: "borrower", fiscalPeriodEnd: "2022-12-31", value: 147433 }],
      [{ dealId: "d", factKey: "EBITDA", ownerType: "borrower", fiscalPeriodEnd: "2022-12-31", value: 147433 }],
      golden,
    );
    assert.equal(r.zero, 1);
  });
});
