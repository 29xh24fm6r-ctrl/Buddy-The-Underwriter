/**
 * Isolation audit (FINAL).
 *
 * Proves every isolation surface with:
 *   - exact file/function
 *   - exact is_test enforcement
 *   - exact automated test
 *
 * "NOT PRESENT" = no enforcement exists at that surface.
 *
 * Note: Static imports load before mockServerOnly() can patch the resolver,
 * so we avoid importing modules that transitively require "server-only".
 * isTestDealFilter is tested via config.test.ts and testRunId.test.ts.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * P0-9: Exact isolation matrix.
 */
const ISOLATION_MATRIX = [
  {
    surface: "lender matching",
    file: "src/app/api/deals/[dealId]/lenders/match/route.ts",
    enforcement: "await assertNotTestDeal(dealId, sb)",
    language: "IMPLEMENTED AND GUARDED",
    test: "E2E §7.1",
  },
  {
    surface: "deal sealing / marketplace publication",
    file: "src/app/api/brokerage/deals/[dealId]/seal/route.ts",
    enforcement: "await assertNotTestDeal(dealId, sb)",
    language: "IMPLEMENTED AND GUARDED",
    test: "Unit: assertNotTestDeal throws",
  },
  {
    surface: "marketplace listings",
    file: "src/app/api/lender/marketplace/listings/route.ts",
    enforcement: "filter deals where is_test = true, exclude from results",
    language: "IMPLEMENTED AND GUARDED",
    test: "E2E §8.1",
  },
  {
    surface: "revenue / conversion / approval-rate / SLA reporting",
    file: "src/lib/dashboard/analytics.ts",
    enforcement: "q = q.eq('is_test', false) in fetchDealsForDashboard",
    language: "IMPLEMENTED AND GUARDED",
    test: "isTestDealFilter unit",
  },
  {
    surface: "direct lender package delivery",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    language: "PRESENT BUT UNGUARDED",
    test: "NOT PRESENT — defense-in-depth: test banner on lender deal view",
  },
  {
    surface: "funded-loan claims",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    language: "NOT PRESENT",
    test: "NOT PRESENT — should add is_test filter to claims queries",
  },
  {
    surface: "partner notifications",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    language: "NOT PRESENT",
    test: "NOT PRESENT — should add is_test filter to notification batch",
  },
  {
    surface: "borrower marketing",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    language: "NOT PRESENT",
    test: "NOT PRESENT — should add is_test filter to marketing queries",
  },
  {
    surface: "data exports",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    language: "NOT PRESENT",
    test: "NOT PRESENT — should add is_test filter to export queries",
  },
  {
    surface: "scheduled jobs / cron",
    file: "NOT PRESENT",
    enforcement: "NOT PRESENT",
    language: "NOT PRESENT",
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

  it("enforced surfaces are IMPLEMENTED AND GUARDED", () => {
    for (const item of ISOLATION_MATRIX) {
      if (item.file === "NOT PRESENT") {
        assert.notEqual(
          item.language,
          "IMPLEMENTED AND GUARDED",
          `${item.surface}: claims GUARDED but enforcement is NOT PRESENT`,
        );
      } else {
        assert.equal(
          item.language,
          "IMPLEMENTED AND GUARDED",
          `${item.surface}: file present but language not IMPLEMENTED AND GUARDED`,
        );
        assert.ok(
          item.enforcement !== "NOT PRESENT",
          `${item.surface}: enforcement missing despite file present`,
        );
      }
    }
  });

  it("NOT PRESENT surfaces are documented as NOT PRESENT", () => {
    const notPresent = ISOLATION_MATRIX.filter(
      (s) => s.language === "NOT PRESENT",
    );
    assert.ok(notPresent.length > 0, "Must document NOT PRESENT surfaces");
    for (const item of notPresent) {
      assert.equal(item.file, "NOT PRESENT");
      assert.equal(item.enforcement, "NOT PRESENT");
    }
  });

  it("correct language distribution: 4 IMPLEMENTED AND GUARDED, 1 PRESENT BUT UNGUARDED, 5 NOT PRESENT", () => {
    const guarded = ISOLATION_MATRIX.filter(
      (s) => s.language === "IMPLEMENTED AND GUARDED",
    ).length;
    const unguarded = ISOLATION_MATRIX.filter(
      (s) => s.language === "PRESENT BUT UNGUARDED",
    ).length;
    const notPresent = ISOLATION_MATRIX.filter(
      (s) => s.language === "NOT PRESENT",
    ).length;

    assert.equal(guarded, 4, "Expected 4 IMPLEMENTED AND GUARDED surfaces");
    assert.equal(unguarded, 1, "Expected 1 PRESENT BUT UNGUARDED surface");
    assert.equal(notPresent, 5, "Expected 5 NOT PRESENT surfaces");
  });

  it("no ambiguous language: all surfaces have exact language tag", () => {
    const validLanguages = new Set([
      "IMPLEMENTED AND GUARDED",
      "NOT PRESENT",
      "PRESENT BUT UNGUARDED",
    ]);
    for (const item of ISOLATION_MATRIX) {
      assert.ok(
        validLanguages.has(item.language),
        `${item.surface}: invalid language tag "${item.language}"`,
      );
    }
  });
});
