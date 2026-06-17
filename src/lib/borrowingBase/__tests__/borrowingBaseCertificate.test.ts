/**
 * SPEC-BORROWING-BASE-CERTIFICATE-ENGINE-1 (Phase 1 + 4) — pure certificate builder tests.
 *
 * Proves the borrowing-base math (eligible -> gross BB -> reserves -> net -> availability -> excess),
 * the status ladder (never "approved"/"certified" without approval state; "blocked" on a blocker
 * exception), over-advance / requested-advance exceptions, and the rendered line block.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildBorrowingBaseCertificate,
  borrowingBaseCertificateLines,
  isBorrowingBaseActive,
  type BorrowingBaseCertificateInput,
} from "../borrowingBaseCertificate";
import { DEFAULT_ENABLED_CATEGORIES, type EligibilityCustomer } from "../eligibilityRules";

const POLICY = {
  enabledCategories: DEFAULT_ENABLED_CATEGORIES,
  concentrationLimit: 0.5,
  advanceRate: 0.8,
  concentrationReserve: 0.05,
  dilutionReserve: 0.05,
  source: "default" as const,
};

const cust = (customerName: string, total: number, opts: Partial<EligibilityCustomer> = {}): EligibilityCustomer => ({
  customerName,
  total,
  current: opts.current ?? total,
  d30: 0,
  d60: 0,
  d90: 0,
  d120: opts.d120 ?? 0,
});

function input(overrides: Partial<BorrowingBaseCertificateInput> = {}): BorrowingBaseCertificateInput {
  return {
    dealId: "d1",
    bankId: "b1",
    borrowerName: "Acme Co",
    lenderName: "First Bank",
    facilityLimit: 1000,
    outstandingPrincipal: 50,
    asOfDate: "2026-04-28",
    certificateDate: "2026-04-30",
    arAging: {
      asOfDate: "2026-04-28",
      reportedTotal: 300,
      over90: 100,
      customers: [cust("E1", 100), cust("E2", 100), cust("Old", 100, { current: 0, d120: 100 })],
      hasInvoiceDetail: true,
    },
    policy: POLICY,
    ...overrides,
  };
}

describe("buildBorrowingBaseCertificate", () => {
  it("computes the full borrowing-base waterfall", () => {
    const c = buildBorrowingBaseCertificate(input());
    assert.equal(c.grossAR, 300);
    assert.equal(c.ineligibleAR, 100); // "Old" wholly over-90
    assert.equal(c.eligibleAR, 200);
    assert.equal(c.grossBorrowingBase, 160); // 200 * 0.8
    assert.equal(c.reserves.concentration, 10); // 200 * 0.05
    assert.equal(c.reserves.dilution, 10);
    assert.equal(c.reserves.total, 20);
    assert.equal(c.netBorrowingBase, 140); // 160 - 20
    assert.equal(c.availability, 140); // < facility limit
    assert.equal(c.excessAvailability, 90); // 140 - 50 outstanding
  });

  it("never reports 'approved' / 'certified' without approval state — tops out at ready_for_review", () => {
    const c = buildBorrowingBaseCertificate(input());
    assert.equal(c.certificateStatus, "ready_for_review");
    assert.notEqual(c.certificateStatus, "approved");
    const header = borrowingBaseCertificateLines(c)[0];
    assert.match(header, /READY FOR REVIEW/);
    assert.doesNotMatch(header.toLowerCase(), /certified/);
  });

  it("blocks on an over-advance (outstanding > net borrowing base)", () => {
    const c = buildBorrowingBaseCertificate(input({ outstandingPrincipal: 500 }));
    assert.equal(c.certificateStatus, "blocked");
    assert.ok(c.exceptions.some((e) => e.code === "OVER_ADVANCE" && e.severity === "blocker"));
  });

  it("blocks when a requested advance exceeds excess availability", () => {
    const c = buildBorrowingBaseCertificate(input({ requestedAdvanceAmount: 1000 }));
    assert.equal(c.certificateStatus, "blocked");
    assert.ok(c.exceptions.some((e) => e.code === "ADVANCE_EXCEEDS_AVAILABILITY"));
  });

  it("caps availability at the facility limit", () => {
    const c = buildBorrowingBaseCertificate(input({ facilityLimit: 100, outstandingPrincipal: 0 }));
    assert.equal(c.netBorrowingBase, 140);
    assert.equal(c.availability, 100); // capped
    assert.equal(c.excessAvailability, 100);
  });

  it("renders certification + signature + banker-review lines", () => {
    const lines = borrowingBaseCertificateLines(buildBorrowingBaseCertificate(input()));
    const joined = lines.join("\n");
    assert.match(joined, /Borrower certification/);
    assert.match(joined, /Authorized signer:/);
    assert.match(joined, /Banker review/);
    assert.match(joined, /Net borrowing base: \$140\.00/);
  });
});

describe("isBorrowingBaseActive", () => {
  it("activates only when AR-collateral data exists", () => {
    assert.equal(isBorrowingBaseActive({}), false);
    assert.equal(isBorrowingBaseActive({ hasArAgingReport: true }), true);
    assert.equal(isBorrowingBaseActive({ hasBorrowingBaseCalc: true }), true);
    assert.equal(isBorrowingBaseActive({ hasArBorrowingBaseFacts: true }), true);
  });
});
