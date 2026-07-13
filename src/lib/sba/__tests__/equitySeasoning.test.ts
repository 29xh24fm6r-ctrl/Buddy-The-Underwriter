import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyEquitySeasoning } from "@/lib/sba/equitySeasoning";

const NOW = new Date("2026-07-12T00:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

test("verifyEquitySeasoning: stable $100K balance for 90+ days -> seasoned=true, no gaps", () => {
  const result = verifyEquitySeasoning({
    equityAmount: 100_000,
    currentBalance: 100_000,
    // Anchor transaction beyond the 90-day window (net zero) so history
    // is considered to cover the full window without moving the balance.
    transactions: [{ posted_date: daysAgo(95), amount: 0 }],
    asOfDate: NOW.toISOString(),
  });
  assert.equal(result.seasoned, true);
  assert.equal(result.gaps.length, 0);
  assert.equal(result.large_deposits.length, 0);
});

test("verifyEquitySeasoning: $100K deposit 30 days ago -> seasoned=false, large deposit gap surfaced", () => {
  const result = verifyEquitySeasoning({
    equityAmount: 100_000,
    currentBalance: 100_000,
    transactions: [
      { posted_date: daysAgo(95), amount: 0 },
      { posted_date: daysAgo(30), amount: -100_000, merchant_name: "Wire Transfer" },
    ],
    asOfDate: NOW.toISOString(),
  });
  assert.equal(result.seasoned, false);
  assert.equal(result.large_deposits.length, 1);
  assert.equal(result.large_deposits[0].amount, 100_000);
  assert.ok(result.gaps.some((g) => g.type === "large_deposit_needs_source_of_funds"));
});

test("verifyEquitySeasoning: no transaction history at all -> seasoning_window_incomplete gap, seasoned=false", () => {
  const result = verifyEquitySeasoning({
    equityAmount: 100_000,
    currentBalance: 100_000,
    transactions: [],
    asOfDate: NOW.toISOString(),
  });
  assert.equal(result.seasoned, false);
  assert.ok(result.gaps.some((g) => g.type === "seasoning_window_incomplete"));
});

test("verifyEquitySeasoning: current balance below required equity amount -> not seasoned", () => {
  const result = verifyEquitySeasoning({
    equityAmount: 90_000,
    currentBalance: 40_000,
    transactions: [
      { posted_date: daysAgo(95), amount: 0 },
      { posted_date: daysAgo(20), amount: 50_000, merchant_name: "Equipment Purchase" },
    ],
    asOfDate: NOW.toISOString(),
  });
  assert.equal(result.seasoned, false);
  assert.ok(result.gaps.some((g) => g.type === "balance_below_equity_amount"));
});

test("verifyEquitySeasoning: only small transactions -> no large-deposit false positives", () => {
  const result = verifyEquitySeasoning({
    equityAmount: 100_000,
    currentBalance: 100_000,
    transactions: [
      { posted_date: daysAgo(95), amount: 0 },
      { posted_date: daysAgo(50), amount: -500, merchant_name: "Small Deposit" },
      { posted_date: daysAgo(49), amount: 500 },
    ],
    asOfDate: NOW.toISOString(),
  });
  assert.equal(result.large_deposits.length, 0);
  assert.equal(result.seasoned, true);
});
