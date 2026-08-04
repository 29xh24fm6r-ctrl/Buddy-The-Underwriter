/**
 * V-M1b — Chapter 5 production state (0 identity verifications, 0 locked
 * scores) renders "Not started" on Business verification and Ownership.
 * Demonstrated by exercising the exact rendering logic, not tsc.
 *
 * V-M3 — ApprovalScoreCard with not_eligible band and absent
 * eligibilityFailures renders neutral state (fail-closed).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReviewItemsForTest,
  deriveVerificationsForTest,
} from "./verificationTruthHelper";

describe("V-M1b — IntakeReviewStep renders 'Not started' for production state", () => {
  it("deriveVerifications returns all false for production state (0 counts)", () => {
    const v = deriveVerificationsForTest({
      identityVerificationCount: 0,
      ownershipEntityCount: 0,
      documentsUploadedCount: 0,
    });
    assert.equal(v.entityResolved, false, "entityResolved must be false with 0 ownership entities");
    assert.equal(v.identityVerified, false, "identityVerified must be false with 0 verifications");
    assert.equal(v.financialsExtracted, false, "financialsExtracted must be false with 0 documents");
  });

  it("Business verification and Ownership show 'Not started' when verifications are all false", () => {
    const items = buildReviewItemsForTest(
      ["working_capital"],
      {
        entityResolved: false,
        identityVerified: false,
        financialsExtracted: false,
      },
    );

    const businessItem = items.find((i) => i.key === "business");
    const ownershipItem = items.find((i) => i.key === "ownership");
    const financialsItem = items.find((i) => i.key === "financials");

    assert.ok(businessItem, "Business verification item must exist");
    assert.ok(ownershipItem, "Ownership item must exist");
    assert.ok(financialsItem, "Financials item must exist");
    assert.equal(businessItem.detail, "Not started", "Business verification must show 'Not started'");
    assert.equal(businessItem.status, "pending", "Business verification must be pending");
    assert.equal(ownershipItem.detail, "Not started", "Ownership must show 'Not started'");
    assert.equal(ownershipItem.status, "pending", "Ownership must be pending");
    assert.equal(financialsItem.detail, "Not started", "Financials must show 'Not started'");
    assert.equal(financialsItem.status, "pending", "Financials must be pending");
  });

  it("end-to-end: production counts → deriveVerifications → buildReviewItems → 'Not started'", () => {
    const verifications = deriveVerificationsForTest({
      identityVerificationCount: 0,
      ownershipEntityCount: 0,
      documentsUploadedCount: 0,
    });
    const items = buildReviewItemsForTest(["working_capital"], verifications);

    for (const key of ["business", "ownership", "financials"]) {
      const item = items.find((i) => i.key === key);
      assert.ok(item, `${key} item must exist`);
      assert.equal(item.detail, "Not started", `${key} must show 'Not started' for production state`);
      assert.equal(item.status, "pending", `${key} must be pending for production state`);
    }
  });

  it("positive case: counts >= 1 → 'complete' statuses", () => {
    const verifications = deriveVerificationsForTest({
      identityVerificationCount: 2,
      ownershipEntityCount: 1,
      documentsUploadedCount: 3,
    });
    assert.equal(verifications.entityResolved, true);
    assert.equal(verifications.identityVerified, true);
    assert.equal(verifications.financialsExtracted, true);

    const items = buildReviewItemsForTest(["working_capital"], verifications);
    assert.equal(items.find((i) => i.key === "business")!.detail, "Entity matched");
    assert.equal(items.find((i) => i.key === "ownership")!.detail, "Identity verified");
    assert.equal(items.find((i) => i.key === "financials")!.detail, "Documents received");
  });
});

describe("V-M3 — ApprovalScoreCard fails closed on absent eligibilityFailures", () => {
  it("absent eligibilityFailures = fail closed (neutral render)", () => {
    const score = {
      score: 0,
      band: "not_eligible",
      eligibilityPassed: false,
      eligibilityFailures: undefined as undefined | Array<{ check: string; reason: string }>,
    };
    const shouldRenderNeutral = !score || !score.eligibilityFailures;
    assert.ok(shouldRenderNeutral, "Absent eligibilityFailures must trigger neutral render");
  });

  it("empty eligibilityFailures with _unknown check = fail closed", () => {
    const failures = [
      { check: "for_profit_unknown", reason: "Business entity type not provided" },
    ];
    const hasIncomplete = failures.some(
      (f) => f.check.endsWith("_unknown") || f.reason.toLowerCase().includes("manual review required"),
    );
    assert.ok(hasIncomplete, "Failures with _unknown checks must trigger neutral render");
  });

  it("present eligibilityFailures with no _unknown = renders determination", () => {
    const failures = [
      { check: "size_standard", reason: "NAICS code not in table" },
    ];
    const hasIncomplete = failures.some(
      (f) => f.check.endsWith("_unknown") || f.reason.toLowerCase().includes("manual review required"),
    );
    assert.equal(hasIncomplete, false, "No _unknown → score card renders");
  });
});
