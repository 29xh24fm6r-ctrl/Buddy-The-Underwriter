/**
 * SPEC-BORROWING-BASE-CERTIFICATE-ENGINE-1 (Phase 6) — OmniCare-shaped fixture.
 *
 * Proves a Borrowing Base Certificate can be generated from the 4/28/2026 AR aging
 * (TOTAL_AR 3,007,506.78, over-90 153,382.59, eligible 332,370.89 at an 80% advance rate, with net
 * availability shown) WHILE the differently-dated 3/31/2026 balance sheet stays blocked: the engine
 * flags the date mismatch, refuses to bridge it, and emits nothing that clears a 3/31 source-detail
 * item. No hard-coded OmniCare — the shape is supplied as fixture data.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildBorrowingBaseCertificate,
  type BorrowingBaseCertificateInput,
} from "../borrowingBaseCertificate";
import { DEFAULT_ENABLED_CATEGORIES, type EligibilityCustomer } from "../eligibilityRules";

const cust = (customerName: string, total: number, kind: "current" | "over90"): EligibilityCustomer => ({
  customerName,
  total,
  current: kind === "current" ? total : 0,
  d30: 0,
  d60: 0,
  d90: 0,
  d120: kind === "over90" ? total : 0,
});

// Customer detail engineered to the live OmniCare 4/28/2026 aggregates:
//   gross 3,007,506.78 = 1,400,000 + 1,121,753.30 (concentration) + 153,382.59 (over-90) + 332,370.89 (eligible)
const CUSTOMERS: EligibilityCustomer[] = [
  cust("National Distributors LLC", 1_400_000.0, "current"), // concentration > 20%
  cust("Regional Health Systems", 1_121_753.3, "current"), // concentration > 20%
  cust("Delinquent Account Co", 153_382.59, "over90"), // over-90
  cust("Eligible One", 100_000.0, "current"),
  cust("Eligible Two", 100_000.0, "current"),
  cust("Eligible Three", 100_000.0, "current"),
  cust("Eligible Four", 32_370.89, "current"),
];

const INPUT: BorrowingBaseCertificateInput = {
  dealId: "deal-omnicare",
  bankId: "bank-omnicare",
  borrowerName: "OmniCare Holdings",
  lenderName: "Community First Bank",
  facilityLimit: 2_500_000,
  outstandingPrincipal: null,
  asOfDate: "2026-04-28",
  certificateDate: "2026-04-30",
  arAging: {
    asOfDate: "2026-04-28",
    reportedTotal: 3_007_506.78,
    over90: 153_382.59,
    customers: CUSTOMERS,
    hasInvoiceDetail: false,
  },
  policy: {
    enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    concentrationLimit: 0.2,
    advanceRate: 0.8,
    concentrationReserve: 0.05,
    dilutionReserve: 0.05,
    source: "default",
  },
  // The spread's most-recent rendered balance-sheet period end — a DIFFERENT date than the AR aging.
  balanceSheet: { asOfDate: "2026-03-31", totalAr: null },
};

describe("Borrowing Base Certificate — OmniCare 4/28/2026", () => {
  const cert = buildBorrowingBaseCertificate(INPUT);

  it("generates the certificate as of 4/28/2026 with the expected aggregates", () => {
    assert.equal(cert.asOfDate, "2026-04-28");
    assert.equal(cert.grossAR, 3_007_506.78);
    assert.equal(cert.eligibleAR, 332_370.89);
    assert.equal(cert.advanceRate, 0.8);
    // over-90 appears as an ineligible-breakdown line at the reported figure.
    const over90 = cert.ineligibleBreakdown.find((b) => b.category === "over_90_days");
    assert.ok(over90, "over-90 breakdown present");
    assert.equal(over90!.amount, 153_382.59);
  });

  it("shows a positive net availability and the advance-rate policy", () => {
    // 332,370.89 * 0.8 = 265,896.71 gross BB; less 5%+5% reserves on eligible AR.
    assert.equal(cert.grossBorrowingBase, 265_896.71);
    assert.ok(cert.netBorrowingBase > 0 && cert.netBorrowingBase < cert.grossBorrowingBase);
    assert.match(cert.auditNotes.join("\n"), /Advance rate 80\.0%/);
  });

  it("flags the date mismatch vs the 3/31/2026 balance sheet and does NOT bridge it", () => {
    assert.ok(cert.dateMismatchVsBalanceSheet);
    assert.equal(cert.dateMismatchVsBalanceSheet!.arAsOf, "2026-04-28");
    assert.equal(cert.dateMismatchVsBalanceSheet!.balanceSheetAsOf, "2026-03-31");
    assert.equal(cert.dateMismatchVsBalanceSheet!.bridged, false);
    assert.ok(cert.exceptions.some((e) => e.code === "AR_AGING_DATE_MISMATCH"));
  });

  it("emits nothing that clears the 3/31/2026 balance-sheet source-detail blocker", () => {
    // The engine explicitly records that it does NOT clear the 3/31 item, and requires a bridge.
    const notes = cert.auditNotes.join("\n");
    assert.match(notes, /does NOT clear/i);
    assert.match(notes, /2026-03-31/);
    assert.ok(cert.requiredSupport.some((r) => /bridge/i.test(r) && /2026-03-31/.test(r)));
    // The certificate is still generatable as of its own date (not blocked by the mismatch alone).
    assert.equal(cert.certificateStatus, "ready_for_review");
  });

  it("surfaces the concentrated accounts in the concentration table", () => {
    const top = cert.customerConcentration[0];
    assert.equal(top.customerName, "National Distributors LLC");
    assert.equal(top.overLimit, true);
  });
});
