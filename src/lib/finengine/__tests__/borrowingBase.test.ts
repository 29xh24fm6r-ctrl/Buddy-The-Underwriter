/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 8 tests.
 *
 * Covers dilution reserve, concentration cap, cross-aging, stale AR (over-90),
 * plus contra / government / foreign / disputed / retainage exclusions, advance
 * rate, and collateral shortfall. Every excluded dollar is attributed to a reason.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeBorrowingBase,
  DEFAULT_BB_POLICY,
  type ARAccount,
} from "@/lib/finengine/abl";

const acct = (o: Partial<ARAccount> & { customerId: string; amount: number; daysPastInvoice: number }): ARAccount => o;

describe("PR8 — stale AR (over-90) exclusion", () => {
  it("excludes an invoice aged beyond 90 days and books the reason", () => {
    const r = computeBorrowingBase(
      [
        acct({ customerId: "A", amount: 100_000, daysPastInvoice: 30 }),
        acct({ customerId: "B", amount: 50_000, daysPastInvoice: 120 }),
      ],
      { ...DEFAULT_BB_POLICY, concentrationCapPct: 1, dilutionReservePct: 0 },
    );
    assert.equal(r.ineligibleByReason.over_90, 50_000);
    assert.equal(r.agingBuckets.over_90, 50_000);
    // Eligible before reserves = 100k (A only).
    assert.equal(r.eligibleBeforeReserves, 100_000);
  });
});

describe("PR8 — cross-aging", () => {
  it("cross-ages ALL of a customer's balance when >50% is over-90", () => {
    const r = computeBorrowingBase([
      acct({ customerId: "C", amount: 40_000, daysPastInvoice: 20 }),
      acct({ customerId: "C", amount: 60_000, daysPastInvoice: 100 }), // 60% over-90 → cross-age whole customer
    ]);
    // The over-90 invoice books over_90; the current invoice books cross_aged.
    assert.equal(r.ineligibleByReason.over_90, 60_000);
    assert.equal(r.ineligibleByReason.cross_aged, 40_000);
    assert.equal(r.eligibleBeforeReserves, 0);
  });

  it("does NOT cross-age when under the threshold", () => {
    const r = computeBorrowingBase(
      [
        acct({ customerId: "D", amount: 80_000, daysPastInvoice: 20 }),
        acct({ customerId: "D", amount: 20_000, daysPastInvoice: 100 }), // 20% over-90 → no cross-age
      ],
      { ...DEFAULT_BB_POLICY, concentrationCapPct: 1, dilutionReservePct: 0 },
    );
    assert.equal(r.ineligibleByReason.cross_aged, 0);
    assert.equal(r.ineligibleByReason.over_90, 20_000);
    assert.equal(r.eligibleBeforeReserves, 80_000);
  });
});

describe("PR8 — concentration cap", () => {
  it("caps a single customer at 20% of total eligible", () => {
    // Big customer 60k of 100k eligible → cap = 20% * 100k = 20k → 40k over-cap out.
    const r = computeBorrowingBase(
      [
        acct({ customerId: "BIG", amount: 60_000, daysPastInvoice: 10 }),
        acct({ customerId: "X1", amount: 10_000, daysPastInvoice: 10 }),
        acct({ customerId: "X2", amount: 10_000, daysPastInvoice: 10 }),
        acct({ customerId: "X3", amount: 10_000, daysPastInvoice: 10 }),
        acct({ customerId: "X4", amount: 10_000, daysPastInvoice: 10 }),
      ],
      { ...DEFAULT_BB_POLICY, dilutionReservePct: 0 },
    );
    assert.equal(r.ineligibleByReason.concentration_cap, 40_000);
    assert.equal(r.eligibleBeforeReserves, 60_000);
  });
});

describe("PR8 — dilution reserve + advance rate + availability", () => {
  it("applies dilution reserve then advance rate", () => {
    const r = computeBorrowingBase(
      [acct({ customerId: "A", amount: 100_000, daysPastInvoice: 10 })],
      { ...DEFAULT_BB_POLICY, concentrationCapPct: 1, dilutionReservePct: 0.05, advanceRate: 0.85 },
    );
    assert.equal(r.dilutionReserve, 5_000);
    assert.equal(r.netEligible, 95_000);
    assert.equal(r.borrowingBaseAvailability, 95_000 * 0.85);
  });
});

describe("PR8 — exclusion categories", () => {
  it("excludes government, foreign, affiliate, disputed, retainage by default", () => {
    const r = computeBorrowingBase([
      acct({ customerId: "G", amount: 10_000, daysPastInvoice: 5, government: true }),
      acct({ customerId: "F", amount: 10_000, daysPastInvoice: 5, foreign: true }),
      acct({ customerId: "AF", amount: 10_000, daysPastInvoice: 5, affiliate: true }),
      acct({ customerId: "DIS", amount: 10_000, daysPastInvoice: 5, disputed: true }),
      acct({ customerId: "RET", amount: 10_000, daysPastInvoice: 5, retainage: true }),
    ]);
    assert.equal(r.ineligibleByReason.government, 10_000);
    assert.equal(r.ineligibleByReason.foreign, 10_000);
    assert.equal(r.ineligibleByReason.affiliate, 10_000);
    assert.equal(r.ineligibleByReason.disputed, 10_000);
    assert.equal(r.ineligibleByReason.retainage, 10_000);
    assert.equal(r.eligibleBeforeReserves, 0);
  });

  it("honors policy toggles making foreign/government eligible", () => {
    const r = computeBorrowingBase(
      [acct({ customerId: "G", amount: 10_000, daysPastInvoice: 5, government: true })],
      { ...DEFAULT_BB_POLICY, governmentEligible: true, dilutionReservePct: 0, concentrationCapPct: 1 },
    );
    assert.equal(r.ineligibleByReason.government, 0);
    assert.equal(r.eligibleBeforeReserves, 10_000);
  });
});

describe("PR8 — contra + collateral shortfall", () => {
  it("reduces eligible by contra amount", () => {
    const r = computeBorrowingBase(
      [acct({ customerId: "A", amount: 100_000, daysPastInvoice: 10, contra: 15_000 })],
      { ...DEFAULT_BB_POLICY, dilutionReservePct: 0, concentrationCapPct: 1 },
    );
    assert.equal(r.ineligibleByReason.contra, 15_000);
    assert.equal(r.eligibleBeforeReserves, 85_000);
  });

  it("computes collateral shortfall vs outstanding loan", () => {
    const r = computeBorrowingBase(
      [acct({ customerId: "A", amount: 100_000, daysPastInvoice: 10 })],
      { ...DEFAULT_BB_POLICY, dilutionReservePct: 0, concentrationCapPct: 1, advanceRate: 0.8 },
      100_000, // outstanding
    );
    // availability = 100k * 0.8 = 80k → shortfall 20k.
    assert.equal(r.borrowingBaseAvailability, 80_000);
    assert.equal(r.collateralShortfall, 20_000);
  });

  it("no shortfall when availability covers outstanding", () => {
    const r = computeBorrowingBase(
      [acct({ customerId: "A", amount: 100_000, daysPastInvoice: 10 })],
      { ...DEFAULT_BB_POLICY, dilutionReservePct: 0, concentrationCapPct: 1, advanceRate: 0.85 },
      50_000,
    );
    assert.equal(r.collateralShortfall, 0);
  });
});
