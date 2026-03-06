/**
 * Cross-Document Reconciliation — Tests
 *
 * All tested functions are pure — no DB stubs needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkK1ToEntity } from "../k1ToEntityCheck";
import { checkBalanceSheet } from "../balanceSheetCheck";
import { checkMultiYearTrend } from "../multiYearTrendCheck";
import { checkOwnershipIntegrity } from "../ownershipIntegrityCheck";
import type { ReconciliationCheck, DealReconciliationSummary } from "../types";

// Helper to build summary from checks (mirrors dealReconciliator logic)
function buildSummary(
  dealId: string,
  checks: ReconciliationCheck[],
): DealReconciliationSummary {
  const passed = checks.filter((c) => c.status === "PASSED");
  const failed = checks.filter((c) => c.status === "FAILED");
  const skipped = checks.filter((c) => c.status === "SKIPPED");
  const hardFailures = failed.filter((c) => c.severity === "HARD");
  const softFlags = failed.filter((c) => c.severity === "SOFT");

  let overallStatus: "CLEAN" | "FLAGS" | "CONFLICTS";
  if (hardFailures.length > 0) {
    overallStatus = "CONFLICTS";
  } else if (softFlags.length > 0) {
    overallStatus = "FLAGS";
  } else {
    overallStatus = "CLEAN";
  }

  return {
    dealId,
    checksRun: checks.length,
    checksPassed: passed.length,
    checksFailed: failed.length,
    checksSkipped: skipped.length,
    hardFailures,
    softFlags,
    overallStatus,
    reconciledAt: new Date().toISOString(),
  };
}

describe("Cross-Document Reconciliation", () => {
  // ── Test 1: K-1 to entity — passes when sum matches ──────────────

  it("K-1 to entity — passes when K-1s sum to OBI within $1", () => {
    const result = checkK1ToEntity({
      entityObi: 325912,
      k1Allocations: [
        { partnerName: "Partner A", ordinaryIncome: 325912, ownershipPct: 1.0 },
      ],
    });

    assert.equal(result.status, "PASSED");
    assert.equal(result.checkId, "K1_TO_ENTITY");
    assert.equal(result.lhsValue, 325912);
  });

  // ── Test 2: K-1 to entity — fails when sum doesn't match ─────────

  it("K-1 to entity — fails when K-1s don't match", () => {
    const result = checkK1ToEntity({
      entityObi: 325912,
      k1Allocations: [
        { partnerName: "Partner A", ordinaryIncome: 269816, ownershipPct: 1.0 },
      ],
    });

    assert.equal(result.status, "FAILED");
    assert.equal(result.severity, "HARD");
    assert.equal(result.delta, 56096); // |325912 - 269816|
    assert.ok(result.notes.includes("do not sum"));
  });

  // ── Test 3: K-1 to entity — skipped when ownership null ──────────

  it("K-1 to entity — skipped when ownership pct missing", () => {
    const result = checkK1ToEntity({
      entityObi: 325912,
      k1Allocations: [
        { partnerName: "Partner A", ordinaryIncome: 325912, ownershipPct: null },
      ],
    });

    assert.equal(result.status, "SKIPPED");
    assert.ok(result.skipReason?.includes("ownership percentage"));
  });

  // ── Test 4: Balance sheet — passes when balanced ──────────────────

  it("balance sheet — passes when assets = liabilities + equity", () => {
    const result = checkBalanceSheet({
      totalAssets: 500000,
      totalLiabilities: 300000,
      totalEquity: 200000,
      sourceName: "Schedule L",
    });

    assert.equal(result.status, "PASSED");
    assert.equal(result.lhsValue, 500000);
    assert.equal(result.rhsValue, 500000); // 300000 + 200000
    assert.equal(result.delta, 0);
  });

  // ── Test 5: Balance sheet — fails when out of balance ─────────────

  it("balance sheet — fails when out of balance", () => {
    const result = checkBalanceSheet({
      totalAssets: 500000,
      totalLiabilities: 300000,
      totalEquity: 150000,
      sourceName: "Schedule L",
    });

    assert.equal(result.status, "FAILED");
    assert.equal(result.severity, "HARD");
    assert.equal(result.delta, 50000); // |500000 - 450000|
    assert.ok(result.notes.includes("does not balance"));
  });

  // ── Test 6: Multi-year trend — soft flag on >50% change ──────────

  it("multi-year trend — soft flag on >50% change", () => {
    const result = checkMultiYearTrend({
      currentRevenue: 1502871,
      priorRevenue: 797989,
      currentYear: 2024,
      priorYear: 2023,
    });

    assert.equal(result.status, "FAILED");
    assert.equal(result.severity, "SOFT");
    assert.ok(result.delta !== null && result.delta > 0); // growth
    assert.ok(result.notes.includes("grew"));
    assert.ok(result.notes.includes("Verify"));
  });

  // ── Test 7: Multi-year trend — passes on <50% change ─────────────

  it("multi-year trend — passes on <50% change", () => {
    const result = checkMultiYearTrend({
      currentRevenue: 1300000,
      priorRevenue: 1000000,
      currentYear: 2024,
      priorYear: 2023,
    });

    assert.equal(result.status, "PASSED");
    assert.equal(result.lhsValue, 1300000);
    assert.equal(result.rhsValue, 1000000);
  });

  // ── Test 8: Ownership integrity — HARD fail when sum > 100% ──────

  it("ownership integrity — fails HARD when sum > 100%", () => {
    const result = checkOwnershipIntegrity({
      k1Allocations: [
        { partnerName: "Partner A", ownershipPct: 0.60 },
        { partnerName: "Partner B", ownershipPct: 0.60 },
      ],
    });

    assert.equal(result.status, "FAILED");
    assert.equal(result.severity, "HARD");
    assert.ok(result.notes.includes("exceeds 100%"));
  });

  // ── Test 9: Ownership integrity — SOFT fail when sum < 95% ───────

  it("ownership integrity — fails SOFT when sum < 95%", () => {
    const result = checkOwnershipIntegrity({
      k1Allocations: [
        { partnerName: "Partner A", ownershipPct: 0.50 },
      ],
    });

    assert.equal(result.status, "FAILED");
    assert.equal(result.severity, "SOFT");
    assert.ok(result.notes.includes("50.0%"));
  });

  // ── Test 10: Summary — CONFLICTS when HARD failure present ───────

  it("summary — CONFLICTS when any HARD failure present", () => {
    const checks: ReconciliationCheck[] = [
      checkBalanceSheet({
        totalAssets: 500000,
        totalLiabilities: 300000,
        totalEquity: 150000,
        sourceName: "Schedule L",
      }),
      checkMultiYearTrend({
        currentRevenue: 1300000,
        priorRevenue: 1000000,
        currentYear: 2024,
        priorYear: 2023,
      }),
    ];

    const summary = buildSummary("deal-1", checks);

    assert.equal(summary.overallStatus, "CONFLICTS");
    assert.equal(summary.hardFailures.length, 1);
    assert.equal(summary.checksFailed, 1);
    assert.equal(summary.checksPassed, 1);
  });

  // ── Test 11: Summary — FLAGS when only SOFT failures present ─────

  it("summary — FLAGS when only SOFT failures present", () => {
    const checks: ReconciliationCheck[] = [
      checkBalanceSheet({
        totalAssets: 500000,
        totalLiabilities: 300000,
        totalEquity: 200000,
        sourceName: "Schedule L",
      }),
      checkMultiYearTrend({
        currentRevenue: 1502871,
        priorRevenue: 797989,
        currentYear: 2024,
        priorYear: 2023,
      }),
    ];

    const summary = buildSummary("deal-2", checks);

    assert.equal(summary.overallStatus, "FLAGS");
    assert.equal(summary.softFlags.length, 1);
    assert.equal(summary.hardFailures.length, 0);
  });

  // ── Test 12: Summary — CLEAN when all pass ───────────────────────

  it("summary — CLEAN when all applicable checks pass", () => {
    const checks: ReconciliationCheck[] = [
      checkK1ToEntity({
        entityObi: 325912,
        k1Allocations: [
          { partnerName: "Partner A", ordinaryIncome: 325912, ownershipPct: 1.0 },
        ],
      }),
      checkBalanceSheet({
        totalAssets: 500000,
        totalLiabilities: 300000,
        totalEquity: 200000,
        sourceName: "Schedule L",
      }),
      checkMultiYearTrend({
        currentRevenue: 1300000,
        priorRevenue: 1000000,
        currentYear: 2024,
        priorYear: 2023,
      }),
    ];

    const summary = buildSummary("deal-3", checks);

    assert.equal(summary.overallStatus, "CLEAN");
    assert.equal(summary.checksRun, 3);
    assert.equal(summary.checksPassed, 3);
    assert.equal(summary.checksFailed, 0);
    assert.equal(summary.hardFailures.length, 0);
    assert.equal(summary.softFlags.length, 0);
  });
});
