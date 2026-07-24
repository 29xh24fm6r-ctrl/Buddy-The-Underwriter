import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const { FakeDb } = require("./testFakeDb") as typeof import("./testFakeDb");
const commissionSplits = require("../commissionSplits") as typeof import("../commissionSplits");

const BANK_A = "bank-a";

test("initializeCommissionSplitsForDeal derives payees from deal_source_attribution and deal_participants, not manual entry", async () => {
  const db = new FakeDb({
    deal_source_attribution: [{ deal_id: "d1", referring_organization_id: "org-1", co_broker_org_id: "org-2", attribution_percentage: 25 }],
    deal_participants: [
      { deal_id: "d1", clerk_user_id: "user-broker-1", role: "broker", is_active: true },
      { deal_id: "d1", clerk_user_id: "user-underwriter", role: "underwriter", is_active: true },
    ],
    brokerage_fee_ledger: [{ id: "f1", deal_id: "d1", fee_type: "lender_referral" }],
  });

  const result = await commissionSplits.initializeCommissionSplitsForDeal(BANK_A, "d1", db as any);
  assert.equal(result.created, 3, "referral partner + co-broker + one internal broker");

  const splits = await commissionSplits.listCommissionSplitsForDeal(BANK_A, "d1", db as any);
  const referral = splits.find((s) => s.split_type === "referral_partner")!;
  assert.equal(referral.payee_org_id, "org-1");
  assert.equal(referral.split_bps, 2500, "attribution_percentage 25 -> 2500 bps");
  assert.equal(referral.fee_ledger_id, "f1");

  const internal = splits.find((s) => s.split_type === "internal_broker")!;
  assert.equal(internal.payee_clerk_user_id, "user-broker-1");

  // Underwriter role must never become a commission payee.
  assert.ok(!splits.some((s) => s.payee_clerk_user_id === "user-underwriter"));
});

test("initializeCommissionSplitsForDeal is idempotent: a second call creates nothing new", async () => {
  const db = new FakeDb({
    deal_source_attribution: [{ deal_id: "d1", referring_organization_id: "org-1", co_broker_org_id: null, attribution_percentage: null }],
  });
  const first = await commissionSplits.initializeCommissionSplitsForDeal(BANK_A, "d1", db as any);
  assert.equal(first.created, 1);
  const second = await commissionSplits.initializeCommissionSplitsForDeal(BANK_A, "d1", db as any);
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 1);
  const splits = await commissionSplits.listCommissionSplitsForDeal(BANK_A, "d1", db as any);
  assert.equal(splits.length, 1);
});

test("recalculateCommissionSplitAmounts recomputes amount_cents from the linked fee ledger amount and split_bps", async () => {
  const db = new FakeDb({
    brokerage_commission_splits: [{ id: "s1", bank_id: BANK_A, deal_id: "d1", fee_ledger_id: "f1", split_type: "referral_partner", split_bps: 2000, amount_cents: null, status: "estimated", created_at: "2026-01-01" }],
    brokerage_fee_ledger: [{ id: "f1", amount_cents: 500000 }],
  });
  const result = await commissionSplits.recalculateCommissionSplitAmounts(BANK_A, "d1", db as any);
  assert.equal(result.updated, 1);
  const splits = await commissionSplits.listCommissionSplitsForDeal(BANK_A, "d1", db as any);
  assert.equal(splits[0].amount_cents, 100000, "500000 * 2000bps / 10000 = 100000");
});

test("updateCommissionSplitStatus moves a split through estimated -> confirmed -> paid", async () => {
  const db = new FakeDb({
    brokerage_commission_splits: [{ id: "s1", bank_id: BANK_A, deal_id: "d1", split_type: "co_broker", status: "estimated", created_at: "2026-01-01" }],
  });
  await commissionSplits.updateCommissionSplitStatus(BANK_A, "s1", "confirmed", db as any);
  await commissionSplits.updateCommissionSplitStatus(BANK_A, "s1", "paid", db as any);
  const splits = await commissionSplits.listCommissionSplitsForDeal(BANK_A, "d1", db as any);
  assert.equal(splits[0].status, "paid");
});
