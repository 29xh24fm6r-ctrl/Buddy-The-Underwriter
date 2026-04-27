import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSourcesAndUses } from "@/lib/sba/sbaSourcesAndUses";
import type { UseOfProceedsLine } from "@/lib/sba/sbaReadinessTypes";

const wcUse = (amount: number): UseOfProceedsLine[] => [
  { category: "wc", description: "wc", amount, pctOfTotal: 0 },
];

test("sbaSourcesAndUses: startup with exactly 10% equity passes (SOP 50 10 8 minimum)", () => {
  const result = buildSourcesAndUses({
    loanAmount: 900_000,
    equityInjectionAmount: 100_000,
    equityInjectionSource: "cash_savings",
    sellerNoteEquityPortion: 0,
    sellerNoteFullStandby: false,
    sellerFinancingAmount: 0,
    otherSources: [],
    useOfProceeds: wcUse(1_000_000),
    isNewBusiness: true,
  });
  assert.equal(result.equityInjection.minimumPct, 0.10);
  assert.equal(result.equityInjection.passes, true);
  assert.equal(result.equityInjection.actualPct, 0.10);
});

test("sbaSourcesAndUses: seller note exactly 50% of equity, full standby → passes", () => {
  const result = buildSourcesAndUses({
    loanAmount: 900_000,
    equityInjectionAmount: 100_000,
    equityInjectionSource: "cash_savings",
    sellerNoteEquityPortion: 50_000,
    sellerNoteFullStandby: true,
    sellerFinancingAmount: 0,
    otherSources: [],
    useOfProceeds: wcUse(1_000_000),
    isNewBusiness: false,
  });
  assert.equal(result.equityInjection.passes, true);
  assert.equal(result.equityInjection.sellerNoteCheck.passes, true);
  assert.equal(result.equityInjection.sellerNoteCheck.sellerNotePctOfEquity, 0.5);
  assert.equal(result.equityInjection.sellerNoteCheck.failureReason, null);
});

test("sbaSourcesAndUses: seller note 60% of equity → fails with 'exceeds 50%' reason", () => {
  const result = buildSourcesAndUses({
    loanAmount: 900_000,
    equityInjectionAmount: 100_000,
    equityInjectionSource: "cash_savings",
    sellerNoteEquityPortion: 60_000,
    sellerNoteFullStandby: true,
    sellerFinancingAmount: 0,
    otherSources: [],
    useOfProceeds: wcUse(1_000_000),
    isNewBusiness: false,
  });
  assert.equal(result.equityInjection.passes, false);
  assert.equal(result.equityInjection.sellerNoteCheck.passes, false);
  assert.match(
    result.equityInjection.sellerNoteCheck.failureReason ?? "",
    /exceeds 50%/,
  );
});

test("sbaSourcesAndUses: seller note 30% of equity, no full standby → fails with 'full standby' reason", () => {
  const result = buildSourcesAndUses({
    loanAmount: 900_000,
    equityInjectionAmount: 100_000,
    equityInjectionSource: "cash_savings",
    sellerNoteEquityPortion: 30_000,
    sellerNoteFullStandby: false,
    sellerFinancingAmount: 0,
    otherSources: [],
    useOfProceeds: wcUse(1_000_000),
    isNewBusiness: false,
  });
  assert.equal(result.equityInjection.passes, false);
  assert.equal(result.equityInjection.sellerNoteCheck.passes, false);
  assert.match(
    result.equityInjection.sellerNoteCheck.failureReason ?? "",
    /full standby/,
  );
});

test("sbaSourcesAndUses: sources = uses within $1 → balanced", () => {
  const result = buildSourcesAndUses({
    loanAmount: 900_000,
    equityInjectionAmount: 100_000,
    equityInjectionSource: "cash_savings",
    sellerNoteEquityPortion: 0,
    sellerNoteFullStandby: false,
    sellerFinancingAmount: 0,
    otherSources: [],
    useOfProceeds: wcUse(1_000_000),
    isNewBusiness: false,
  });
  assert.equal(result.totalSources, 1_000_000);
  assert.equal(result.totalUses, 1_000_000);
  assert.equal(result.balanced, true);
  assert.equal(result.imbalance, 0);
});
