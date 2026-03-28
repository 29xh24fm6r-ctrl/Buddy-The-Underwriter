/**
 * Phase 65J — Review Readiness Derivation Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveReviewReadiness, type ReadinessInput } from "./deriveReviewReadiness";

const BASE: ReadinessInput = {
  requirements: [],
  openExceptionCount: 0,
};

describe("deriveReviewReadiness", () => {
  it("returns ready when no requirements and no exceptions", () => {
    assert.equal(deriveReviewReadiness(BASE), "ready");
  });

  it("returns missing_borrower_items when borrower items pending", () => {
    const result = deriveReviewReadiness({
      requirements: [
        { required: true, status: "pending", borrowerVisible: true },
        { required: true, status: "completed", borrowerVisible: false },
      ],
      openExceptionCount: 0,
    });
    assert.equal(result, "missing_borrower_items");
  });

  it("returns missing_borrower_items when borrower items requested", () => {
    const result = deriveReviewReadiness({
      requirements: [
        { required: true, status: "requested", borrowerVisible: true },
      ],
      openExceptionCount: 0,
    });
    assert.equal(result, "missing_borrower_items");
  });

  it("returns missing_banker_review when submitted but unreviewed", () => {
    const result = deriveReviewReadiness({
      requirements: [
        { required: true, status: "submitted", borrowerVisible: true },
        { required: true, status: "completed", borrowerVisible: false },
      ],
      openExceptionCount: 0,
    });
    assert.equal(result, "missing_banker_review");
  });

  it("returns exception_open when exceptions exist", () => {
    const result = deriveReviewReadiness({
      requirements: [
        { required: true, status: "completed", borrowerVisible: true },
      ],
      openExceptionCount: 2,
    });
    assert.equal(result, "exception_open");
  });

  it("exception_open takes precedence over missing items", () => {
    const result = deriveReviewReadiness({
      requirements: [
        { required: true, status: "pending", borrowerVisible: true },
      ],
      openExceptionCount: 1,
    });
    assert.equal(result, "exception_open");
  });

  it("returns ready when all required completed", () => {
    const result = deriveReviewReadiness({
      requirements: [
        { required: true, status: "completed", borrowerVisible: true },
        { required: true, status: "waived", borrowerVisible: false },
        { required: false, status: "pending", borrowerVisible: true },
      ],
      openExceptionCount: 0,
    });
    assert.equal(result, "ready");
  });
});
