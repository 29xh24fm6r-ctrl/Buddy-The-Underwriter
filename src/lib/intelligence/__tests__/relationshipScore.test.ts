import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const { FakeDb } = require("./testFakeDb") as typeof import("./testFakeDb");
const relationshipScore = require("../relationshipScore") as typeof import("../relationshipScore");

const BANK_A = "bank-a";
const BANK_B = "bank-b";
const ORG_1 = "org-1";

test("relationship score exposes individual components, not just an opaque number", async () => {
  const now = new Date();
  const db = new FakeDb({
    crm_activities: [{ id: "a1", bank_id: BANK_A, target_organization_id: ORG_1, happens_at: now.toISOString(), direction: "inbound" }],
    brokerage_leads: [{ id: "l1", bank_id: BANK_A, referral_source_org_id: ORG_1, status: "qualified", created_at: now.toISOString(), converted_at: now.toISOString(), loan_amount_requested: 500000 }],
    deals: [{ id: "d1", bank_id: BANK_A, referral_source_org_id: ORG_1, loan_amount: 500000, brokerage_stage: "funded" }],
    brokerage_fee_ledger: [{ id: "f1", deal_id: "d1", amount_cents: 500000, status: "funded" }],
  });

  const score = await relationshipScore.computeOrganizationRelationshipScore(BANK_A, ORG_1, db as any);

  assert.equal(score.organizationId, ORG_1);
  assert.ok(typeof score.overallScore === "number" && score.overallScore >= 0 && score.overallScore <= 100);
  assert.equal(typeof score.components.recencyScore, "number");
  assert.equal(typeof score.components.engagementScore, "number");
  assert.equal(score.components.referralVolume12mo, 1);
  assert.equal(score.components.conversionRate, 1);
  assert.equal(score.components.fundedVolumeCents, 50000000);
  assert.equal(score.components.revenueGeneratedCents, 500000);
  assert.ok(score.weights.recency > 0, "weights must be visible, not hidden inside the score");
});

test("relationship score: an organization with no activity gets a low recency score, not an error", async () => {
  const db = new FakeDb({});
  const score = await relationshipScore.computeOrganizationRelationshipScore(BANK_A, "org-empty", db as any);
  assert.equal(score.components.daysSinceLastContact, null);
  assert.equal(score.components.recencyScore, 0);
});

test("tenant isolation: an organization's referral volume never counts another bank's leads", async () => {
  const now = new Date();
  const db = new FakeDb({
    brokerage_leads: [
      { id: "l1", bank_id: BANK_A, referral_source_org_id: ORG_1, status: "new", created_at: now.toISOString(), converted_at: null, loan_amount_requested: 100000 },
      { id: "l2", bank_id: BANK_B, referral_source_org_id: ORG_1, status: "new", created_at: now.toISOString(), converted_at: null, loan_amount_requested: 999999 },
    ],
  });
  const score = await relationshipScore.computeOrganizationRelationshipScore(BANK_A, ORG_1, db as any);
  assert.equal(score.components.referralVolume12mo, 1, "must not count bank B's lead referencing the same org id");
});
