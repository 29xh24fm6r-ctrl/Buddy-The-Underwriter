/**
 * SPEC-JOURNEY-RAIL-UNDERWRITING-FLOW-PRIORITY-1 — header "Loan" amount fallback.
 *
 * deals.amount wins when present; otherwise the latest active submitted loan request amount is used.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveDealLoanAmount } from "../resolveDealLoanAmount";

describe("resolveDealLoanAmount", () => {
  it("uses deals.amount when present", () => {
    assert.equal(resolveDealLoanAmount(500_000, [{ status: "submitted", requested_amount: 999, request_number: 1 }]), 500_000);
  });

  it("falls back to the active submitted loan request when amount is null", () => {
    assert.equal(
      resolveDealLoanAmount(null, [{ status: "submitted", requested_amount: 750_000, request_number: 1 }]),
      750_000,
    );
  });

  it("ignores draft requests and requests without a positive amount", () => {
    assert.equal(
      resolveDealLoanAmount(null, [
        { status: "draft", requested_amount: 1_000_000, request_number: 2 },
        { status: "submitted", requested_amount: null, request_number: 3 },
        { status: "submitted", requested_amount: 0, request_number: 4 },
      ]),
      null,
    );
  });

  it("prefers the latest submitted request (highest request_number)", () => {
    assert.equal(
      resolveDealLoanAmount(null, [
        { status: "submitted", requested_amount: 400_000, request_number: 1 },
        { status: "approved", requested_amount: 650_000, request_number: 2 },
      ]),
      650_000,
    );
  });

  it("returns null when there are no usable requests", () => {
    assert.equal(resolveDealLoanAmount(null, []), null);
    assert.equal(resolveDealLoanAmount(null, null), null);
    assert.equal(resolveDealLoanAmount(undefined, undefined), null);
  });
});
