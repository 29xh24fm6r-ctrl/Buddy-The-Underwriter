import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const DEAL_SHELL = path.resolve("src/app/(app)/deals/[dealId]/DealShell.tsx");

describe("Underwriting route singularity", () => {
  it("DealShell nav includes /underwrite tab", () => {
    const content = fs.readFileSync(DEAL_SHELL, "utf-8");
    assert.ok(
      content.includes('label: "Underwrite"') && content.includes("/underwrite"),
      "DealShell must have an Underwrite tab pointing to /underwrite",
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

  it("canonical underwrite page embeds the retired underwriter Stitch surface", () => {
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/deals/[dealId]/underwrite/page.tsx"),
      "utf-8",
    );
    assert.ok(
      content.includes('surfaceKey="deals_command_bridge"'),
      "Must embed deals_command_bridge as the transitional Stitch layer",
    );
    assert.ok(
      !content.includes('surfaceKey="underwrite"'),
      "Must not use surfaceKey='underwrite' — no real Stitch export exists for that key",
    );
  });
});
