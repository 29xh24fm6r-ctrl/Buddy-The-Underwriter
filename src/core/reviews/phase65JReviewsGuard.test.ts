/**
 * Phase 65J — Reviews Guard Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("Phase 65J — Reviews Guards", () => {
  it("migration exists with all tables", () => {
    const p = join(root, "supabase/migrations/20260512_annual_review_renewal_engine.sql");
    assert.ok(existsSync(p), "migration must exist");
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("deal_annual_review_cases"), "must create annual review cases");
    assert.ok(content.includes("deal_renewal_cases"), "must create renewal cases");
    assert.ok(content.includes("deal_review_case_requirements"), "must create requirements");
    assert.ok(content.includes("deal_review_case_exceptions"), "must create exceptions");
    assert.ok(content.includes("deal_review_case_outputs"), "must create outputs");
  });

  it("no Omega imports in reviews layer", () => {
    const files = [
      "types.ts", "createAnnualReviewCase.ts", "createRenewalCase.ts",
      "seedReviewRequirements.ts", "buildReviewBorrowerPlan.ts",
      "createReviewBorrowerCampaign.ts", "reconcileReviewSubmission.ts",
      "deriveReviewReadiness.ts", "deriveReviewBlockingParty.ts",
      "carryForwardMonitoringExceptions.ts", "queueReviewOutputGeneration.ts",
      "completeReviewCase.ts",
    ];
    for (const file of files) {
      const p = join(root, "src/core/reviews", file);
      if (!existsSync(p)) continue;
      const content = readFileSync(p, "utf-8");
      assert.ok(!content.includes("@/core/omega"), `${file} must not import Omega`);
    }
  });

  it("processor route uses CRON_SECRET", () => {
    const p = join(root, "src/app/api/admin/reviews/process/route.ts");
    assert.ok(existsSync(p), "processor must exist");
    assert.ok(readFileSync(p, "utf-8").includes("CRON_SECRET"));
  });

  it("reviews API exists", () => {
    const p = join(root, "src/app/api/deals/[dealId]/reviews/route.ts");
    assert.ok(existsSync(p), "reviews route must exist");
  });

  it("case completion requires readiness = ready", () => {
    const p = join(root, "src/core/reviews/completeReviewCase.ts");
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("deriveReviewReadiness"), "must derive readiness before completing");
    assert.ok(content.includes('"ready"'), "must check readiness === ready");
  });

  it("borrower campaigns reuse 65F infrastructure", () => {
    const p = join(root, "src/core/reviews/createReviewBorrowerCampaign.ts");
    assert.ok(existsSync(p), "createReviewBorrowerCampaign must exist");
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("borrower_request_campaigns"), "must use borrower_request_campaigns");
    assert.ok(content.includes("borrower_request_items"), "must use borrower_request_items");
  });

  it("65H queue reasons include review/renewal codes", () => {
    const p = join(root, "src/core/command-center/queueReasonCatalog.ts");
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("annual_review_collecting"), "must have collecting reason");
    assert.ok(content.includes("annual_review_under_review"), "must have under_review reason");
    assert.ok(content.includes("renewal_collecting"), "must have renewal collecting");
    assert.ok(content.includes("renewal_ready"), "must have renewal ready");
    assert.ok(content.includes("review_exception_open"), "must have review exception");
  });

  it("key derivation functions exist", () => {
    const required = [
      "seedReviewRequirements.ts",
      "deriveReviewReadiness.ts",
      "carryForwardMonitoringExceptions.ts",
      "createReviewBorrowerCampaign.ts",
    ];
    for (const file of required) {
      assert.ok(existsSync(join(root, "src/core/reviews", file)), `${file} must exist`);
    }
  });

  it("Reviews tab in DealShell", () => {
    const content = readFileSync(join(root, "src/app/(app)/deals/[dealId]/DealShell.tsx"), "utf-8");
    assert.ok(content.includes("Reviews"), "DealShell must include Reviews tab");
    assert.ok(content.includes("/reviews"), "DealShell must link to /reviews");
  });
});
