/**
 * Phase 65I — Post-Close Monitoring Guard Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("Phase 65I — Post-Close Guards", () => {
  // Guard 1: Migration exists
  it("post-close migration exists with all tables", () => {
    const migPath = join(root, "supabase/migrations/20260511_post_close_monitoring.sql");
    assert.ok(existsSync(migPath), "migration must exist");
    const content = readFileSync(migPath, "utf-8");
    assert.ok(content.includes("deal_monitoring_programs"), "must create programs table");
    assert.ok(content.includes("deal_monitoring_obligations"), "must create obligations table");
    assert.ok(content.includes("deal_monitoring_cycles"), "must create cycles table");
    assert.ok(content.includes("deal_monitoring_exceptions"), "must create exceptions table");
    assert.ok(content.includes("deal_annual_reviews"), "must create annual reviews table");
    assert.ok(content.includes("deal_renewal_prep"), "must create renewal prep table");
  });

  // Guard 2: No Omega imports in post-close core
  it("no Omega imports in post-close layer", () => {
    const coreDir = join(root, "src/core/post-close");
    const files = [
      "types.ts",
      "monitoringCatalog.ts",
      "createMonitoringProgram.ts",
      "seedMonitoringObligations.ts",
      "generateMonitoringCycles.ts",
      "reconcileMonitoringSubmission.ts",
      "completeMonitoringCycle.ts",
      "openMonitoringException.ts",
      "resolveMonitoringException.ts",
      "deriveMonitoringSeverity.ts",
      "deriveMonitoringBlockingParty.ts",
      "seedAnnualReview.ts",
      "seedRenewalPrep.ts",
    ];
    for (const file of files) {
      const p = join(coreDir, file);
      if (!existsSync(p)) continue;
      const content = readFileSync(p, "utf-8");
      assert.ok(!content.includes("@/core/omega"), `${file} must not import Omega`);
    }
  });

  // Guard 3: Background processor uses CRON_SECRET
  it("processor route uses CRON_SECRET auth", () => {
    const p = join(root, "src/app/api/admin/post-close/process/route.ts");
    assert.ok(existsSync(p), "processor route must exist");
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("CRON_SECRET"), "must use CRON_SECRET");
  });

  // Guard 4: Post-close API exists
  it("post-close deal API exists", () => {
    const p = join(root, "src/app/api/deals/[dealId]/post-close/route.ts");
    assert.ok(existsSync(p), "post-close route must exist");
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("deriveMonitoringProgramSummary"), "must derive program summary");
  });

  // Guard 5: Review completion is banker-confirmed
  it("cycle completion requires banker confirmation", () => {
    const p = join(root, "src/core/post-close/completeMonitoringCycle.ts");
    assert.ok(existsSync(p), "completeMonitoringCycle must exist");
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("reviewedBy"), "must require reviewer identity");
    assert.ok(
      content.includes("under_review") || content.includes("submitted"),
      "must check cycle is in reviewable state",
    );
  });

  // Guard 6: Reconciliation does not auto-complete
  it("reconciliation does not auto-complete cycles", () => {
    const p = join(root, "src/core/post-close/reconcileMonitoringSubmission.ts");
    assert.ok(existsSync(p), "reconcileMonitoringSubmission must exist");
    const content = readFileSync(p, "utf-8");
    assert.ok(
      !content.includes('status: "completed"'),
      "reconciliation must not set status to completed",
    );
    assert.ok(
      content.includes('"submitted"'),
      "reconciliation must transition to submitted",
    );
  });

  // Guard 7: 65H queue reasons extended for post-close
  it("65H queue reasons include post-close codes", () => {
    const p = join(root, "src/core/command-center/queueReasonCatalog.ts");
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("post_close_reporting_overdue"), "must have reporting overdue reason");
    assert.ok(content.includes("annual_review_due"), "must have annual review reason");
    assert.ok(content.includes("renewal_prep_due"), "must have renewal prep reason");
    assert.ok(content.includes("monitoring_exception_open"), "must have exception reason");
  });

  // Guard 8: Key derivation functions exist
  it("core derivation functions exist", () => {
    const required = [
      "generateMonitoringCycles.ts",
      "reconcileMonitoringSubmission.ts",
      "seedAnnualReview.ts",
      "seedRenewalPrep.ts",
      "deriveMonitoringSeverity.ts",
      "deriveMonitoringBlockingParty.ts",
    ];
    for (const file of required) {
      const p = join(root, "src/core/post-close", file);
      assert.ok(existsSync(p), `${file} must exist`);
    }
  });

  // Guard 9: 65F borrower campaigns reused
  it("obligation seeding references borrower campaigns for reuse", () => {
    const p = join(root, "src/core/post-close/types.ts");
    const content = readFileSync(p, "utf-8");
    assert.ok(
      content.includes("borrower_campaign_id"),
      "types must reference borrower_campaign_id for 65F reuse",
    );
  });

  // Guard 10: Post-close tab added to DealShell
  it("post-close tab exists in DealShell", () => {
    const p = join(root, "src/app/(app)/deals/[dealId]/DealShell.tsx");
    const content = readFileSync(p, "utf-8");
    assert.ok(content.includes("Post-Close"), "DealShell must include Post-Close tab");
    assert.ok(content.includes("/post-close"), "DealShell must link to /post-close");
  });
});
