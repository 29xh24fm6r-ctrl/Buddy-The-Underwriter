import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildDepositProfile } from "../depositProfileBuilder";

describe("Deposit Profile Builder", () => {
  it("Test 1: CONSISTENT pattern, no low balance periods", () => {
    const balances = Array.from({ length: 12 }, (_, i) => ({
      month: `2025-${String(i + 1).padStart(2, "0")}`,
      avgBalance: 200000,
    }));

    const profile = buildDepositProfile(balances);

    assert.equal(profile.seasonalPattern, "CONSISTENT");
    assert.equal(profile.averageDailyBalance, 200000);
    assert.equal(profile.balanceVolatility, 0);
    assert.equal(profile.lowBalancePeriods.length, 0);
    assert.equal(profile.creditSignals.length, 0);
    assert.equal(profile.depositRelationshipValue, 600); // 200000 * 0.003
  });

  it("Test 2: SEASONAL pattern detected", () => {
    const balances = [
      ...Array.from({ length: 6 }, (_, i) => ({
        month: `2025-${String(i + 1).padStart(2, "0")}`,
        avgBalance: 400000,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        month: `2025-${String(i + 7).padStart(2, "0")}`,
        avgBalance: 100000,
      })),
    ];

    const profile = buildDepositProfile(balances);

    assert.equal(profile.seasonalPattern, "SEASONAL");
    assert.equal(profile.highestMonthlyBalance, 400000);
    assert.equal(profile.lowestMonthlyBalance, 100000);
  });

  it("Test 3: low balance period flagged as credit signal", () => {
    const balances = Array.from({ length: 12 }, (_, i) => ({
      month: `2025-${String(i + 1).padStart(2, "0")}`,
      avgBalance: i === 5 ? 20000 : 200000,
    }));

    const profile = buildDepositProfile(balances);

    assert.equal(profile.lowBalancePeriods.length, 1);
    assert.equal(profile.lowBalancePeriods[0].balance, 20000);
    assert.ok(
      profile.lowBalancePeriods[0].flag.includes("below 50% of average")
    );
    assert.ok(profile.creditSignals.length > 0);
  });

  it("Test 4: INSUFFICIENT_DATA when <6 months", () => {
    const balances = [
      { month: "2025-01", avgBalance: 100000 },
      { month: "2025-02", avgBalance: 120000 },
      { month: "2025-03", avgBalance: 110000 },
    ];

    const profile = buildDepositProfile(balances);

    assert.equal(profile.seasonalPattern, "INSUFFICIENT_DATA");
    assert.ok(profile.averageDailyBalance !== null);
  });
});
