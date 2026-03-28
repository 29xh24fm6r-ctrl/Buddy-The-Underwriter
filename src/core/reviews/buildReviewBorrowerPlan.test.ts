/**
 * Phase 65J — Build Review Borrower Plan Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReviewBorrowerPlan } from "./buildReviewBorrowerPlan";
import type { ReviewRequirement } from "./types";

function makeReq(overrides: Partial<ReviewRequirement> = {}): ReviewRequirement {
  return {
    id: "r1",
    requirementCode: "annual_financial_statements",
    title: "Annual Financial Statements",
    description: "Please upload.",
    borrowerVisible: true,
    status: "pending",
    required: true,
    evidenceType: "document_submit",
    ...overrides,
  };
}

describe("buildReviewBorrowerPlan", () => {
  it("only includes borrower-visible requirements", () => {
    const plan = buildReviewBorrowerPlan("annual_review", [
      makeReq({ borrowerVisible: true }),
      makeReq({ id: "r2", requirementCode: "risk_rating_refresh", borrowerVisible: false }),
    ]);
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0].itemCode, "annual_financial_statements");
  });

  it("only includes pending requirements", () => {
    const plan = buildReviewBorrowerPlan("annual_review", [
      makeReq({ status: "pending" }),
      makeReq({ id: "r2", status: "completed" }),
    ]);
    assert.equal(plan.items.length, 1);
  });

  it("sets correct campaign title for annual review", () => {
    const plan = buildReviewBorrowerPlan("annual_review", [makeReq()]);
    assert.ok(plan.campaignTitle.includes("Annual Review"));
  });

  it("sets correct campaign title for renewal", () => {
    const plan = buildReviewBorrowerPlan("renewal", [makeReq()]);
    assert.ok(plan.campaignTitle.includes("Renewal"));
  });

  it("no internal jargon in borrower items", () => {
    const plan = buildReviewBorrowerPlan("annual_review", [makeReq()]);
    for (const item of plan.items) {
      assert.ok(!item.title.includes("risk_rating"), "no risk_rating in borrower title");
      assert.ok(!item.title.includes("blocker"), "no blocker in borrower title");
      assert.ok(!item.description.includes("Omega"), "no Omega in borrower description");
    }
  });
});
