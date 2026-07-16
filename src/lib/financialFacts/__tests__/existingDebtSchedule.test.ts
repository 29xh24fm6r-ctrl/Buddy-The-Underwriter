import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeActiveAnnualDebtService,
  toExistingDebtItems,
  isReplaceableExistingDebt,
  debtScheduleEntryToRow,
  PLACEHOLDER_EXISTING_DEBT_DESCRIPTION,
  type ExistingDebtScheduleRow,
} from "@/lib/financialFacts/existingDebtSchedule";
import type { DebtScheduleEntry } from "@/lib/financialFacts/debtScheduleAutoBuilder";

function row(overrides: Partial<ExistingDebtScheduleRow>): ExistingDebtScheduleRow {
  return {
    deal_id: "deal-1",
    lender_name: "Chase",
    ...overrides,
  };
}

test("computeActiveAnnualDebtService: sums annual_debt_service when present", () => {
  const total = computeActiveAnnualDebtService([
    row({ annual_debt_service: 12000 }),
    row({ annual_debt_service: 6000 }),
  ]);
  assert.equal(total, 18000);
});

test("computeActiveAnnualDebtService: falls back to monthly_payment * 12 when annual_debt_service is null", () => {
  const total = computeActiveAnnualDebtService([row({ monthly_payment: 500 })]);
  assert.equal(total, 6000);
});

test("computeActiveAnnualDebtService: excludes rows being refinanced by the new SBA loan", () => {
  const total = computeActiveAnnualDebtService([
    row({ annual_debt_service: 12000, is_being_refinanced: true }),
    row({ annual_debt_service: 6000 }),
  ]);
  assert.equal(total, 6000);
});

test("computeActiveAnnualDebtService: excludes rows explicitly marked included_in_global=false", () => {
  const total = computeActiveAnnualDebtService([
    row({ annual_debt_service: 12000, included_in_global: false }),
    row({ annual_debt_service: 6000 }),
  ]);
  assert.equal(total, 6000);
});

test("computeActiveAnnualDebtService: empty schedule sums to 0", () => {
  assert.equal(computeActiveAnnualDebtService([]), 0);
});

test("toExistingDebtItems: maps a real row into the ExistingDebtItem shape sbaForwardModelBuilder.ts consumes", () => {
  const items = toExistingDebtItems([
    row({
      lender_name: "Chase",
      loan_type: "mortgage",
      current_balance: 240_000,
      monthly_payment: 1_800,
      maturity_date: null,
    }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].description, "Chase (mortgage)");
  assert.equal(items[0].currentBalance, 240_000);
  assert.equal(items[0].monthlyPayment, 1_800);
  assert.equal(items[0].remainingTermMonths, 60); // no maturity_date -> default
});

test("toExistingDebtItems: excludes rows being refinanced", () => {
  const items = toExistingDebtItems([row({ is_being_refinanced: true, monthly_payment: 500 })]);
  assert.equal(items.length, 0);
});

test("isReplaceableExistingDebt: empty/null is replaceable", () => {
  assert.equal(isReplaceableExistingDebt(null), true);
  assert.equal(isReplaceableExistingDebt(undefined), true);
  assert.equal(isReplaceableExistingDebt([]), true);
});

test("isReplaceableExistingDebt: the single fabricated ADS placeholder is replaceable", () => {
  assert.equal(
    isReplaceableExistingDebt([
      {
        description: PLACEHOLDER_EXISTING_DEBT_DESCRIPTION,
        currentBalance: 0,
        monthlyPayment: 500,
        remainingTermMonths: 60,
      },
    ]),
    true,
  );
});

test("isReplaceableExistingDebt: real borrower/banker-entered data is never replaced", () => {
  assert.equal(
    isReplaceableExistingDebt([
      { description: "Chase (mortgage)", currentBalance: 240_000, monthlyPayment: 1_800, remainingTermMonths: 180 },
    ]),
    false,
  );
});

test("isReplaceableExistingDebt: two items (even if one looks like the placeholder) is never replaced", () => {
  assert.equal(
    isReplaceableExistingDebt([
      { description: PLACEHOLDER_EXISTING_DEBT_DESCRIPTION, currentBalance: 0, monthlyPayment: 500, remainingTermMonths: 60 },
      { description: "Amex", currentBalance: 5000, monthlyPayment: 200, remainingTermMonths: 24 },
    ]),
    false,
  );
});

test("debtScheduleEntryToRow: maps a future Plaid-derived entry onto the shared table shape, tagged plaid_auto", () => {
  const entry: DebtScheduleEntry = {
    creditor: "Wells Fargo",
    monthly_payment: 900,
    estimated_balance: 54_000,
    account_type_inferred: "auto_loan",
    confidence: 0.7,
  };
  const mapped = debtScheduleEntryToRow(entry, { dealId: "deal-1", bankId: "bank-1" });
  assert.equal(mapped.deal_id, "deal-1");
  assert.equal(mapped.bank_id, "bank-1");
  assert.equal(mapped.lender_name, "Wells Fargo");
  assert.equal(mapped.loan_type, "auto_loan");
  assert.equal(mapped.current_balance, 54_000);
  assert.equal(mapped.monthly_payment, 900);
  assert.equal(mapped.annual_debt_service, 10_800);
  assert.equal(mapped.is_being_refinanced, false);
  assert.equal(mapped.included_in_global, true);
  assert.equal(mapped.source, "plaid_auto");
  assert.equal(mapped.confidence, 0.7);
});
