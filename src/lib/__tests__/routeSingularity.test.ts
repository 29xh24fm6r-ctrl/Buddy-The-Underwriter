import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const DEAL_SHELL = path.resolve("src/app/(app)/deals/[dealId]/DealShell.tsx");
const STAGE_ROUTES = path.resolve("src/components/journey/stageRoutes.ts");

describe("Underwriting route singularity", () => {
  it("Journey rail stage routes point to /underwrite (not /underwriter or /underwrite-console)", () => {
    // SPEC-01: stage-specific navigation moved from DealShell tabs to JourneyRail.
    // The canonical underwrite route is still /underwrite and is now reached via
    // stageRoutes for underwrite_ready / underwrite_in_progress.
    const content = fs.readFileSync(STAGE_ROUTES, "utf-8");
    assert.ok(
      content.includes("/underwrite") && content.includes("underwrite_ready"),
      "stageRoutes must route underwrite stages to /underwrite",
    );
  });

  it("DealShell nav does NOT link to /underwriter", () => {
    const content = fs.readFileSync(DEAL_SHELL, "utf-8");
    assert.ok(
      !content.includes("/underwriter"),
      "DealShell must not link to /underwriter — retired route",
    );
  });

  it("DealShell nav does NOT link to /underwrite-console", () => {
    const content = fs.readFileSync(DEAL_SHELL, "utf-8");
    assert.ok(
      !content.includes("/underwrite-console"),
      "DealShell must not link to /underwrite-console — retired route",
    );
  });

  it("Journey stageRoutes does NOT route to retired /underwriter or /underwrite-console", () => {
    const content = fs.readFileSync(STAGE_ROUTES, "utf-8");
    assert.ok(!content.includes("/underwriter"), "stageRoutes must not link to /underwriter");
    assert.ok(
      !content.includes("/underwrite-console"),
      "stageRoutes must not link to /underwrite-console",
    );
  });

  it("/underwriter route redirects to /underwrite", () => {
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/deals/[dealId]/underwriter/page.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("RETIRED ROUTE"), "Must be marked as retired");
    assert.ok(content.includes("redirect("), "Must redirect");
    assert.ok(content.includes("/underwrite"), "Must redirect to canonical /underwrite");
  });

  it("/underwrite-console route redirects to /underwrite", () => {
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/deals/[dealId]/underwrite-console/page.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("RETIRED ROUTE"), "Must be marked as retired");
    assert.ok(content.includes("redirect("), "Must redirect");
    assert.ok(content.includes("/underwrite"), "Must redirect to canonical /underwrite");
  });

  it("canonical underwrite page declares itself as canonical", () => {
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/deals/[dealId]/underwrite/page.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("CANONICAL UNDERWRITING ROUTE"));
    assert.ok(content.includes("AnalystWorkbench"));
  });
});
