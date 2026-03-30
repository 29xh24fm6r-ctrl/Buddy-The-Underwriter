import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENTS_DIR = path.resolve(__dirname, "../../../components/underwrite");
const API_DIR = path.resolve(__dirname, "../../../app/api/deals/[dealId]/underwrite");

// ─── Workbench components exist ───────────────────────────────────────────────

describe("Analyst Workbench components", () => {
  const REQUIRED = [
    "AnalystWorkbench.tsx",
    "SnapshotBanner.tsx",
    "DriftBanner.tsx",
    "WorkstreamCard.tsx",
  ];

  for (const f of REQUIRED) {
    it(`${f} exists`, () => {
      assert.ok(fs.existsSync(path.join(COMPONENTS_DIR, f)), `${f} must exist`);
    });
  }
});

// ─── Snapshot awareness ───────────────────────────────────────────────────────

describe("Snapshot awareness in workbench", () => {
  it("AnalystWorkbench renders snapshot banner", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "AnalystWorkbench.tsx"), "utf-8");
    assert.ok(content.includes("SnapshotBanner"));
  });

  it("AnalystWorkbench renders drift banner", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "AnalystWorkbench.tsx"), "utf-8");
    assert.ok(content.includes("DriftBanner"));
  });

  it("WorkstreamCard shows snapshot label", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "WorkstreamCard.tsx"), "utf-8");
    assert.ok(content.includes("snapshotLabel"));
    assert.ok(content.includes("Seeded from"));
  });

  it("WorkstreamCard shows stale badge", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "WorkstreamCard.tsx"), "utf-8");
    assert.ok(content.includes("isStale"));
    assert.ok(content.includes("Stale"));
  });

  it("SnapshotBanner shows launch sequence", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "SnapshotBanner.tsx"), "utf-8");
    assert.ok(content.includes("launchSequence"));
    assert.ok(content.includes("Snapshot"));
  });
});

// ─── No new truth engines ─────────────────────────────────────────────────────

describe("No new truth engines in workbench", () => {
  it("AnalystWorkbench has no supabaseAdmin import", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "AnalystWorkbench.tsx"), "utf-8");
    assert.ok(!content.includes("supabaseAdmin"), "Workbench UI must not import supabaseAdmin");
  });

  it("AnalystWorkbench fetches from /underwrite/state only", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "AnalystWorkbench.tsx"), "utf-8");
    assert.ok(content.includes("/underwrite/state"), "Must fetch from underwrite state API");
  });

  it("AnalystWorkbench uses existing seed package types", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "AnalystWorkbench.tsx"), "utf-8");
    assert.ok(content.includes("SpreadSeedPackage") || content.includes("spreadSeed"));
    assert.ok(content.includes("MemoSeedPackage") || content.includes("memoSeed"));
  });
});

// ─── API structure ────────────────────────────────────────────────────────────

describe("Underwrite API routes", () => {
  it("state route exists", () => {
    assert.ok(fs.existsSync(path.join(API_DIR, "state/route.ts")));
  });

  it("workspace route exists", () => {
    assert.ok(fs.existsSync(path.join(API_DIR, "workspace/route.ts")));
  });

  it("state route uses existing seed builders", () => {
    const content = fs.readFileSync(path.join(API_DIR, "state/route.ts"), "utf-8");
    assert.ok(content.includes("buildSpreadSeedPackage"));
    assert.ok(content.includes("buildMemoSeedPackage"));
  });

  it("state route uses canonical drift detector", () => {
    const content = fs.readFileSync(path.join(API_DIR, "state/route.ts"), "utf-8");
    assert.ok(content.includes("detectCanonicalDrift"));
  });

  it("state route uses canonical loan request resolver", () => {
    const content = fs.readFileSync(path.join(API_DIR, "state/route.ts"), "utf-8");
    assert.ok(content.includes("getCanonicalLoanRequestForUnderwriting"));
  });

  it("workspace route validates allowed statuses", () => {
    const content = fs.readFileSync(path.join(API_DIR, "workspace/route.ts"), "utf-8");
    assert.ok(content.includes("ALLOWED_STATUSES"));
    assert.ok(content.includes("not_started"));
    assert.ok(content.includes("in_progress"));
    assert.ok(content.includes("completed"));
  });
});

// ─── Drift visibility in execution ────────────────────────────────────────────

describe("Drift visible in workbench execution", () => {
  it("DriftBanner shows per-item impact scope", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "DriftBanner.tsx"), "utf-8");
    assert.ok(content.includes("all_underwriting"));
    assert.ok(content.includes("spreads"));
    assert.ok(content.includes("memo"));
  });

  it("DriftBanner offers Review Drift action", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "DriftBanner.tsx"), "utf-8");
    assert.ok(content.includes("Review Drift"));
  });

  it("DriftBanner offers Refresh Underwriting for material drift", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "DriftBanner.tsx"), "utf-8");
    assert.ok(content.includes("Refresh Underwriting"));
    assert.ok(content.includes("isMaterial"));
  });

  it("AnalystWorkbench tracks stale state per workstream", () => {
    const content = fs.readFileSync(path.join(COMPONENTS_DIR, "AnalystWorkbench.tsx"), "utf-8");
    assert.ok(content.includes("spreadStale"));
    assert.ok(content.includes("memoStale"));
  });
});

// ─── Copy rules ───────────────────────────────────────────────────────────────

describe("Workbench copy rules", () => {
  it("does not use 'Current state' or 'Latest version'", () => {
    for (const f of ["AnalystWorkbench.tsx", "SnapshotBanner.tsx", "DriftBanner.tsx"]) {
      const content = fs.readFileSync(path.join(COMPONENTS_DIR, f), "utf-8");
      assert.ok(!content.includes('"Current state"'), `${f} must not use "Current state"`);
      assert.ok(!content.includes('"Latest version"'), `${f} must not use "Latest version"`);
    }
  });
});
