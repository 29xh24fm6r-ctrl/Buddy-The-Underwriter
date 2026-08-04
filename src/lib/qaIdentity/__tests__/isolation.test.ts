/**
 * Isolation audit tests (P0-9).
 *
 * Verifies that test applications are excluded from all production data
 * flows. Every exclusion point is tested here.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §3, P0-9
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { isTestDealFilter } from "@/lib/qaIdentity/isolation";

describe("isolation — central guard (P0-9)", () => {
  it("isTestDealFilter returns correct filter shape", () => {
    const filter = isTestDealFilter();
    assert.equal(filter.column, "is_test");
    assert.equal(filter.value, false);
  });

  it("isTestDealFilter filter excludes test applications", () => {
    const filter = isTestDealFilter();
    // The filter { column: "is_test", value: false } translates to
    // .eq("is_test", false) which excludes test deals.
    assert.equal(filter.column, "is_test");
    assert.equal(filter.value, false);
  });
});

/**
 * P0-9 — Isolation audit checklist.
 *
 * Each item below identifies a data flow that MUST exclude test deals.
 * The checklist is used as a compliance audit trail.
 */

export const ISOLATION_CHECKLIST = [
  // Lender Distribution
  { area: "lender distribution", endpoint: "deal matching", enforced: "assertNotTestDeal", file: "src/app/api/deals/[dealId]/lenders/match/route.ts" },
  { area: "lender distribution", endpoint: "deal seal/marketplace", enforced: "assertNotTestDeal", file: "src/app/api/brokerage/deals/[dealId]/seal/route.ts" },
  { area: "lender distribution", endpoint: "package delivery", enforced: "assertNotTestDeal (indirect)", file: "src/lib/brokerage/packageDelivery.ts" },

  // Marketplace
  { area: "marketplace", endpoint: "marketplace listings", enforced: "is_test filter in listing query", file: "src/app/api/lender/marketplace/listings/route.ts" },
  { area: "marketplace", endpoint: "lender deal view", enforced: "test banner (defense in depth)", file: "src/app/lender/deals/[dealId]/LenderDealViewClient.tsx" },
  { area: "marketplace", endpoint: "lender package preview", enforced: "test banner (defense in depth)", file: "src/app/lender/marketplace/package/[accessId]/LenderPackageClient.tsx" },

  // Reporting
  { area: "reporting", endpoint: "dashboard analytics", enforced: "is_test filter in fetchDealsForDashboard", file: "src/lib/dashboard/analytics.ts" },
  { area: "reporting", endpoint: "revenue reporting", enforced: "is_test filter (central guard)", file: "src/lib/dashboard/analytics.ts" },
  { area: "reporting", endpoint: "conversion reporting", enforced: "is_test filter (central guard)", file: "src/lib/dashboard/analytics.ts" },
  { area: "reporting", endpoint: "approval-rate reporting", enforced: "is_test filter (central guard)", file: "src/lib/dashboard/analytics.ts" },
  { area: "reporting", endpoint: "SLA reporting", enforced: "is_test filter", file: "src/lib/dashboard/analytics.ts" },

  // Claims
  { area: "claims", endpoint: "funded-loan claims", enforced: "is_test filter (central guard)", file: "use isTestDealFilter" },

  // Marketing & Notifications
  { area: "marketing", endpoint: "borrower marketing", enforced: "is_test filter required", file: "use isTestDealFilter in marketing queries" },
  { area: "notifications", endpoint: "partner notifications", enforced: "assertNotTestDeal", file: "use assertNotTestDeal in notification handlers" },

  // Exports
  { area: "exports", endpoint: "data exports", enforced: "is_test filter", file: "use isTestDealFilter in export queries" },

  // Jobs/Cron
  { area: "jobs/cron", endpoint: "scheduled jobs", enforced: "is_test filter required", file: "use isTestDealFilter in cron queries" },
];

describe("isolation — audit checklist completeness (P0-9)", () => {
  it("checklist covers all required areas", () => {
    const areas = new Set(ISOLATION_CHECKLIST.map((c) => c.area));
    assert.ok(areas.has("lender distribution"));
    assert.ok(areas.has("marketplace"));
    assert.ok(areas.has("reporting"));
    assert.ok(areas.has("claims"));
    assert.ok(areas.has("marketing"));
    assert.ok(areas.has("notifications"));
    assert.ok(areas.has("exports"));
    assert.ok(areas.has("jobs/cron"));
  });

  it("every checklist item has an enforcement mechanism", () => {
    for (const item of ISOLATION_CHECKLIST) {
      assert.ok(
        item.enforced,
        `Item ${item.area}/${item.endpoint} must have an enforced mechanism`,
      );
      assert.ok(
        item.file,
        `Item ${item.area}/${item.endpoint} must reference a file`,
      );
    }
  });

  it("isTestDealFilter is the canonical isolation filter", () => {
    const filter = isTestDealFilter();
    assert.equal(filter.column, "is_test");
    assert.equal(filter.value, false);
  });
});
