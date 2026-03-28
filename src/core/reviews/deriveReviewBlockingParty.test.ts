/**
 * Phase 65J — Review Blocking Party Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveReviewBlockingParty, type ReviewBlockingInput } from "./deriveReviewBlockingParty";

describe("deriveReviewBlockingParty", () => {
  it("returns borrower when missing borrower items", () => {
    assert.equal(
      deriveReviewBlockingParty({ readinessState: "missing_borrower_items", hasOutputsInFlight: false }),
      "borrower",
    );
  });

  it("returns banker when missing banker review", () => {
    assert.equal(
      deriveReviewBlockingParty({ readinessState: "missing_banker_review", hasOutputsInFlight: false }),
      "banker",
    );
  });

  it("returns banker when exception open", () => {
    assert.equal(
      deriveReviewBlockingParty({ readinessState: "exception_open", hasOutputsInFlight: false }),
      "banker",
    );
  });

  it("returns buddy when outputs in flight", () => {
    assert.equal(
      deriveReviewBlockingParty({ readinessState: "missing_banker_review", hasOutputsInFlight: true }),
      "buddy",
    );
  });

  it("returns unknown when ready", () => {
    assert.equal(
      deriveReviewBlockingParty({ readinessState: "ready", hasOutputsInFlight: false }),
      "unknown",
    );
  });
});
