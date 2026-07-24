import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const { FakeDb } = require("./testFakeDb") as typeof import("./testFakeDb");
const revenue = require("../revenue") as typeof import("../revenue");

const BANK_A = "bank-a";

test("revenue rollup: groups funded deals by source, lender, and loan type without mislabeling loan amount as revenue", async () => {
  const db = new FakeDb({
    deals: [
      { id: "d1", bank_id: BANK_A, referral_source_org_id: "org-1", loan_amount: 5000000, brokerage_stage: "funded" },
      { id: "d2", bank_id: BANK_A, referral_source_org_id: "org-1", loan_amount: 1000000, brokerage_stage: "funded" },
    ],
    brokerage_fee_ledger: [
      { id: "f1", deal_id: "d1", amount_cents: 750000, status: "funded" },
      { id: "f2", deal_id: "d2", amount_cents: 150000, status: "funded" },
    ],
    brokerage_commission_splits: [{ id: "s1", deal_id: "d1", amount_cents: 100000 }],
    crm_organizations: [{ id: "org-1", name: "Acme Referrals" }],
    brokerage_funding_verifications: [{ deal_id: "d1", lender_bank_id: "lender-1", status: "verified" }],
    banks: [{ id: "lender-1", name: "First Bank" }],
    brokerage_leads: [],
    deal_participants: [],
  });

  const rollup = await revenue.computeRevenueRollup(BANK_A, db as any);

  assert.equal(rollup.totalFundedDeals, 2);
  // Gross/net revenue must be the fee-ledger amount, never the loan_amount (5,000,000 / 1,000,000).
  assert.equal(rollup.totalGrossRevenueCents, 900000);
  assert.equal(rollup.totalNetRevenueCents, 800000);
  assert.notEqual(rollup.totalGrossRevenueCents, 6000000, "must never equal summed loan_amount");
  const bySourceRow = rollup.bySource.find((g) => g.key === "org-1")!;
  assert.equal(bySourceRow.label, "Acme Referrals");
  assert.equal(bySourceRow.grossRevenueCents, 900000);
});

test("revenue rollup: unattributed and unassigned deals are grouped, not dropped", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", bank_id: BANK_A, referral_source_org_id: null, loan_amount: 200000, brokerage_stage: "funded" }],
    brokerage_fee_ledger: [{ id: "f1", deal_id: "d1", amount_cents: 30000, status: "earned" }],
  });
  const rollup = await revenue.computeRevenueRollup(BANK_A, db as any);
  assert.equal(rollup.bySource[0]?.key, "unattributed");
  assert.equal(rollup.byLender[0]?.key, "unassigned");
});

test("findFundedDealsMissingVerification: flags a funded deal with no verified funding-verification row", async () => {
  const db = new FakeDb({
    deals: [
      { id: "d1", bank_id: BANK_A, brokerage_stage: "funded" },
      { id: "d2", bank_id: BANK_A, brokerage_stage: "funded" },
    ],
    brokerage_funding_verifications: [{ deal_id: "d1", status: "verified" }],
  });
  const missing = await revenue.findFundedDealsMissingVerification(BANK_A, db as any);
  assert.deepEqual(missing, ["d2"]);
});

test("tenant isolation: revenue rollup never includes another bank's deals", async () => {
  const db = new FakeDb({
    deals: [
      { id: "d1", bank_id: BANK_A, loan_amount: 100, brokerage_stage: "funded" },
      { id: "d2", bank_id: "bank-b", loan_amount: 999999999, brokerage_stage: "funded" },
    ],
    brokerage_fee_ledger: [{ id: "f2", deal_id: "d2", amount_cents: 999999999, status: "funded" }],
  });
  const rollup = await revenue.computeRevenueRollup(BANK_A, db as any);
  assert.equal(rollup.totalFundedDeals, 1);
  assert.equal(rollup.totalGrossRevenueCents, 0, "bank B's fee ledger amount must not leak into bank A's rollup");
});
