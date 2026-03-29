import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { detectCanonicalDrift } from "../detectCanonicalDrift";

const LAUNCH_ROUTE = path.resolve(
  __dirname,
  "../../../app/api/deals/[dealId]/launch-underwriting/route.ts",
);
const COCKPIT_STATE_ROUTE = path.resolve(
  __dirname,
  "../../../app/api/deals/[dealId]/cockpit-state/route.ts",
);

// ─── A. Launch wraps existing activation ──────────────────────────────────────

describe("Launch API wraps ensureUnderwritingActivatedCore", () => {
  it("imports ensureUnderwritingActivatedCore", () => {
    const content = fs.readFileSync(LAUNCH_ROUTE, "utf-8");
    assert.ok(content.includes("ensureUnderwritingActivatedCore"));
  });

  it("does NOT independently mutate lifecycle_stage", () => {
    const content = fs.readFileSync(LAUNCH_ROUTE, "utf-8");
    // Should not have direct deals.update({ lifecycle_stage }) — activation core handles this
    const lines = content.split("\n").filter(
      (l) => !l.trim().startsWith("//") && l.includes("lifecycle_stage") && l.includes(".update"),
    );
    assert.equal(lines.length, 0, "Launch should not directly mutate lifecycle — activation core does this");
  });

  it("uses canonical loan request from deal_loan_requests", () => {
    const content = fs.readFileSync(LAUNCH_ROUTE, "utf-8");
    assert.ok(content.includes("getCanonicalLoanRequestForUnderwriting"));
    assert.ok(content.includes("canonical_loan_request_id"));
  });

  it("stores canonical references in snapshot", () => {
    const content = fs.readFileSync(LAUNCH_ROUTE, "utf-8");
    assert.ok(content.includes("canonical_loan_request_id"));
    assert.ok(content.includes("financial_snapshot_id"));
  });

  it("rejects without submitted canonical loan request", () => {
    const content = fs.readFileSync(LAUNCH_ROUTE, "utf-8");
    assert.ok(content.includes("no submitted canonical loan request"));
  });
});

// ─── B. Cockpit-state uses canonical loan request ─────────────────────────────

describe("Cockpit-state canonical loan request", () => {
  it("reads from deal_loan_requests as primary source", () => {
    const content = fs.readFileSync(COCKPIT_STATE_ROUTE, "utf-8");
    assert.ok(content.includes("deal_loan_requests"));
    assert.ok(content.includes("ONLY canonical loan request source"));
  });

  it("Phase 55 loan_requests is fallback only", () => {
    const content = fs.readFileSync(COCKPIT_STATE_ROUTE, "utf-8");
    assert.ok(content.includes("migration period only"));
  });
});

// ─── C. Canonical drift detection ─────────────────────────────────────────────

describe("detectCanonicalDrift", () => {
  const base = {
    snapshotCanonicalLoanRequestId: "lr-1",
    snapshotFinancialSnapshotId: "fs-1",
    snapshotLifecycleStage: "underwriting",
    snapshotDocumentsReadinessPct: 100,
    currentCanonicalLoanRequestId: "lr-1",
    currentCanonicalLoanRequestUpdatedAt: "2026-01-01",
    currentFinancialSnapshotId: "fs-1",
    currentLifecycleStage: "underwriting",
    currentDocumentsReadinessPct: 100,
    currentBlockerCount: 0,
    snapshotLoanAmount: 500000,
    currentLoanAmount: 500000,
    snapshotProductType: "term",
    currentProductType: "term",
    snapshotCollateralType: "real_estate",
    currentCollateralType: "real_estate",
  };

  it("no drift when canonical references match", () => {
    const result = detectCanonicalDrift(base);
    assert.equal(result.hasDrift, false);
  });

  it("detects canonical loan request replacement", () => {
    const result = detectCanonicalDrift({ ...base, currentCanonicalLoanRequestId: "lr-2" });
    assert.equal(result.hasDrift, true);
    assert.ok(result.items.some((i) => i.code === "canonical_loan_request_replaced"));
  });

  it("detects financial snapshot change", () => {
    const result = detectCanonicalDrift({ ...base, currentFinancialSnapshotId: "fs-2" });
    assert.equal(result.hasDrift, true);
    assert.ok(result.items.some((i) => i.code === "financial_snapshot_changed"));
  });

  it("detects readiness regression", () => {
    const result = detectCanonicalDrift({ ...base, currentDocumentsReadinessPct: 60 });
    assert.equal(result.hasDrift, true);
    assert.equal(result.severity, "material");
  });

  it("detects product type change", () => {
    const result = detectCanonicalDrift({ ...base, currentProductType: "revolver" });
    assert.equal(result.hasDrift, true);
  });

  it("deterministic", () => {
    const r1 = detectCanonicalDrift(base);
    const r2 = detectCanonicalDrift(base);
    assert.deepEqual(r1, r2);
  });
});

// ─── D. Pure file guards ──────────────────────────────────────────────────────

describe("56R pure file guards", () => {
  const DIR = path.resolve(__dirname, "..");

  it("detectCanonicalDrift has no DB imports", () => {
    const content = fs.readFileSync(path.join(DIR, "detectCanonicalDrift.ts"), "utf-8");
    assert.ok(!content.includes("supabaseAdmin"));
  });

  it("computeEligibility has no DB imports", () => {
    const content = fs.readFileSync(path.join(DIR, "computeEligibility.ts"), "utf-8");
    assert.ok(!content.includes("supabaseAdmin"));
  });

  it("buildSeedPackages has no DB imports", () => {
    const content = fs.readFileSync(path.join(DIR, "buildSeedPackages.ts"), "utf-8");
    assert.ok(!content.includes("supabaseAdmin"));
  });
});
