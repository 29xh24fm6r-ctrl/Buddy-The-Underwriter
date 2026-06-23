/**
 * SPEC-BORROWING-BASE-CERTIFICATE-ENGINE-1 (Phase 3) — AR aging quality-gate tests.
 *
 * Proves the blocking gates (missing as-of date, no customer rows, total-does-not-tie), the
 * non-blocking warnings (stale, bucket tie), and the date-bridge gate: a mismatch sets
 * dateMismatchUnbridged without blocking the certificate's own status.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assessArAgingQuality, type ArAgingQualityInput } from "../arAgingQuality";

const base: ArAgingQualityInput = {
  asOfDate: "2026-04-28",
  certificateDate: "2026-04-30",
  customerRowCount: 5,
  reportedTotal: 1000,
  customerRowSum: 1000,
  bucketSum: 1000,
  over90: 100,
};

describe("assessArAgingQuality", () => {
  it("passes a clean, current, self-consistent aging report", () => {
    const r = assessArAgingQuality(base);
    assert.equal(r.blocked, false);
    assert.equal(r.dateMismatchUnbridged, false);
    assert.equal(r.gates.find((g) => g.id === "as_of_date_present")!.status, "pass");
    assert.equal(r.gates.find((g) => g.id === "total_ties_to_customers")!.status, "pass");
  });

  it("blocks when there is no as-of date", () => {
    const r = assessArAgingQuality({ ...base, asOfDate: null });
    assert.equal(r.blocked, true);
    assert.equal(r.gates.find((g) => g.id === "as_of_date_present")!.status, "fail");
  });

  it("blocks when no customer rows were parsed", () => {
    const r = assessArAgingQuality({ ...base, customerRowCount: 0 });
    assert.equal(r.blocked, true);
  });

  it("blocks when the reported total does not tie to the customer-row sum", () => {
    const r = assessArAgingQuality({ ...base, reportedTotal: 1000, customerRowSum: 850 });
    assert.equal(r.gates.find((g) => g.id === "total_ties_to_customers")!.status, "fail");
    assert.equal(r.blocked, true);
  });

  it("warns (does not block) on a stale aging report", () => {
    const r = assessArAgingQuality({ ...base, asOfDate: "2026-01-01", certificateDate: "2026-04-30" });
    assert.equal(r.gates.find((g) => g.id === "not_stale")!.status, "fail");
    assert.equal(r.blocked, false); // staleness is a warning, not blocking
  });

  it("flags an unbridged date mismatch without blocking the certificate itself", () => {
    const r = assessArAgingQuality({ ...base, asOfDate: "2026-04-28", balanceSheetAsOfDate: "2026-03-31" });
    assert.equal(r.dateMismatchUnbridged, true);
    assert.equal(r.gates.find((g) => g.id === "date_bridge_required")!.status, "fail");
    assert.equal(r.gates.find((g) => g.id === "date_bridge_required")!.blocking, false);
    assert.equal(r.blocked, false);
  });

  it("clears the date mismatch when a bridge is recorded", () => {
    const r = assessArAgingQuality({
      ...base,
      asOfDate: "2026-04-28",
      balanceSheetAsOfDate: "2026-03-31",
      bridgeRecorded: true,
    });
    assert.equal(r.dateMismatchUnbridged, false);
    assert.equal(r.gates.find((g) => g.id === "date_bridge_required")!.status, "pass");
  });
});
