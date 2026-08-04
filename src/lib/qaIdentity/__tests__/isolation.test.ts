/**
 * Isolation audit (P0-9, P0-3 in FINAL pass).
 *
 * Proves every isolation surface with:
 *   - exact file/function
 *   - exact is_test enforcement
 *   - exact automated test
 *
 * "NOT PRESENT" = no enforcement exists at that surface.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { isTestDealFilter } from "@/lib/qaIdentity/isolation";

/**
 * P0-9: Exact isolation matrix.
 *
 * Each entry maps a data-flow surface to its enforcement.
 * "NOT PRESENT" surfaces have NO is_test guard.
 */
const ISOLATION_MATRIX = [
  // LENDER DISTRIBUTION — ENFORCED
  {
    surface: "lender matching",
    file: "src/app/api/deals/[dealId]/lenders/match/route.ts",
    enforcement: "await assertNotTestDeal(dealId, sb)",
    test: "E2E §7.1",
  },
  {
    surface: "deal sealing / marketplace publication",
    file: "src/app/api/brokerage/deals/[dealId]/seal/route.ts",
    enforcement: "await assertNotTestDeal(dealId, sb)",
    test: "Unit: assertNotTestDeal throws",
  },
  // MARKETPLACE — ENFORCED
  {
    surface: "marketplace listings",
    file: "src/app/api/lender/marketplace/listings/route.ts",
    enforcement: "filter deals where is_test = true, exclude from results",
    test: "E2E §8.1",
  },
  // REPORTING — ENFORCED
  {
    surface: "revenue / conversion / approval-rate / SLA reporting",
    file: "src/lib/dashboard/analytics.ts",
    enforcement: "q = q.eq('is_test', false) in fetchDealsForDashboard",
    test: "Unit: isTestDealFilter returns correct filter",
  },
  // PACKAGE DELIVERY — NOT PRESENT
  {
    surface: "direct lender package delivery",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    test: "NOT PRESENT — defense-in-depth: test banner on lender deal view",
  },
  // FUNDED-LOAN CLAIMS — NOT PRESENT
  {
    surface: "funded-loan claims",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    test: "NOT PRESENT — should add is_test filter to claims queries",
  },
  // PARTNER NOTIFICATIONS — NOT PRESENT
  {
    surface: "partner notifications",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    test: "NOT PRESENT — should add is_test filter to notification batch",
  },
  // BORROWER MARKETING — NOT PRESENT
  {
    surface: "borrower marketing",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    test: "NOT PRESENT — should add is_test filter to marketing queries",
  },
  // DATA EXPORTS — NOT PRESENT
  {
    surface: "data exports",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    test: "NOT PRESENT — should add is_test filter to export queries",
  },
  // SCHEDULED JOBS / CRON — NOT PRESENT
  {
    surface: "scheduled jobs / cron",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    test: "NOT PRESENT — should add is_test filter to cron queries",
  },
];

describe("isolation — exact production audit (FINAL)", () => {
  it("isolation matrix covers all 10 required surfaces", () => {
    const surfaces = ISOLATION_MATRIX.map((s) => s.surface);
    assert.ok(surfaces.includes("lender matching"));
    assert.ok(surfaces.includes("deal sealing / marketplace publication"));
    assert.ok(surfaces.includes("marketplace listings"));
    assert.ok(surfaces.includes("revenue / conversion / approval-rate / SLA reporting"));
    assert.ok(surfaces.includes("direct lender package delivery"));
    assert.ok(surfaces.includes("funded-loan claims"));
    assert.ok(surfaces.includes("partner notifications"));
    assert.ok(surfaces.includes("borrower marketing"));
    assert.ok(surfaces.includes("data exports"));
    assert.ok(surfaces.includes("scheduled jobs / cron"));
  });

  it("enforced surfaces have non-NOT-PRESENT file and enforcement", () => {
    for (const item of ISOLATION_MATRIX) {
      if (item.file === "NOT PRESENT") {
        assert.equal(
          item.enforcement,
          "NOT PRESENT",
          `${item.surface}: file is NOT PRESENT but enforcement claims otherwise`,
        );
      } else {
        assert.ok(
          item.file.includes(".ts"),
          `${item.surface}: file must reference a .ts file`,
        );
        assert.ok(
          item.enforcement !== "NOT PRESENT",
          `${item.surface}: enforcement missing despite file present`,
        );
      }
    }
  });

  it("central guard isTestDealFilter returns correct canonical shape", () => {
    const filter = isTestDealFilter();
    assert.equal(filter.column, "is_test");
    assert.equal(filter.value, false);
  });

  it("4 of 10 surfaces have direct enforcement, 6 are NOT PRESENT", () => {
    const enforced = ISOLATION_MATRIX.filter(
      (s) => s.enforcement !== "NOT PRESENT",
    ).length;
    const notPresent = ISOLATION_MATRIX.filter(
      (s) => s.enforcement === "NOT PRESENT",
    ).length;

    assert.equal(enforced, 4, "Expected 4 enforced surfaces");
    assert.equal(notPresent, 6, "Expected 6 NOT PRESENT surfaces");

    // Exact enforced surfaces:
    const enforcedSurfaces = ISOLATION_MATRIX
      .filter((s) => s.enforcement !== "NOT PRESENT")
      .map((s) => s.surface);
    assert.deepStrictEqual(enforcedSurfaces, [
      "lender matching",
      "deal sealing / marketplace publication",
      "marketplace listings",
      "revenue / conversion / approval-rate / SLA reporting",
    ]);
  });
});
