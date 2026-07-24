import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const { FakeDb } = require("./testFakeDb") as typeof import("./testFakeDb");
const referralAnalytics = require("../referralAnalytics") as typeof import("../referralAnalytics");

const BANK_A = "bank-a";
const ORG_1 = "org-1";

test("referral source analytics: conversion rate, revenue, and referral-fee obligations compute correctly", async () => {
  const db = new FakeDb({
    brokerage_leads: [
      { id: "l1", bank_id: BANK_A, referral_source_org_id: ORG_1, status: "converted", created_at: "2026-01-01T00:00:00Z", converted_at: "2026-01-10T00:00:00Z", converted_deal_id: "d1", lost_reason: null, disqualification_reason: null },
      { id: "l2", bank_id: BANK_A, referral_source_org_id: ORG_1, status: "lost", created_at: "2026-01-01T00:00:00Z", converted_at: null, converted_deal_id: null, lost_reason: "went with a bank direct", disqualification_reason: null },
    ],
    deals: [{ id: "d1", bank_id: BANK_A, referral_source_org_id: ORG_1, loan_amount: 1000000, brokerage_stage: "funded", created_at: "2026-01-10T00:00:00Z" }],
    brokerage_fee_ledger: [{ id: "f1", deal_id: "d1", amount_cents: 1000000, status: "funded" }],
    brokerage_commission_splits: [{ id: "s1", deal_id: "d1", amount_cents: 200000, status: "estimated", split_type: "referral_partner", payee_org_id: ORG_1 }],
    brokerage_funding_verifications: [{ id: "v1", deal_id: "d1", status: "verified", funded_at: "2026-01-20T00:00:00Z" }],
  });

  const analytics = await referralAnalytics.computeReferralSourceAnalytics(BANK_A, ORG_1, db as any);

  assert.equal(analytics.leadsReferred, 2);
  assert.equal(analytics.dealsConverted, 1);
  assert.equal(analytics.dealsFunded, 1);
  assert.equal(analytics.loanVolumeCents, 100000000);
  assert.equal(analytics.grossRevenueCents, 1000000);
  assert.equal(analytics.netRevenueCents, 800000, "net = gross - paid-out commission splits");
  assert.equal(analytics.conversionRate, 0.5);
  assert.deepEqual(analytics.lostReasons, ["went with a bank direct"]);
  assert.equal(analytics.referralFeeObligationsCents, 200000, "unpaid referral-partner split owed to this org");
});

test("referral analytics: an organization with no leads returns zeros, not an error", async () => {
  const db = new FakeDb({});
  const analytics = await referralAnalytics.computeReferralSourceAnalytics(BANK_A, "org-empty", db as any);
  assert.equal(analytics.leadsReferred, 0);
  assert.equal(analytics.conversionRate, null);
  assert.equal(analytics.avgDealSizeCents, null);
});
