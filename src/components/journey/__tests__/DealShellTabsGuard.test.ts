import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const DEAL_SHELL = path.resolve("src/app/(app)/deals/[dealId]/DealShell.tsx");
const COCKPIT_CLIENT = path.resolve("src/components/deals/DealCockpitClient.tsx");

const UTILITY_TABS = ["Documents", "Financials", "Risk", "Relationship"] as const;

const REMOVED_STAGE_TABS = [
  "Builder",
  "Underwrite",
  "Committee",
  "Credit Memo",
  "Borrower",
  "Feasibility",
  "Portal",
  "Post-Close",
  "Reviews",
  "Special Assets",
  "SBA Package",
  "Classic Spreads",
] as const;

describe("DealShell — SPEC-01 utility tabs only", () => {
  const src = fs.readFileSync(DEAL_SHELL, "utf-8");

  it("includes all 4 utility tabs", () => {
    for (const label of UTILITY_TABS) {
      assert.ok(
        src.includes(`label: "${label}"`),
        `DealShell must include utility tab "${label}"`,
      );
    }
  });

  it("does NOT include any stage-specific tab in the tabs[] array", () => {
    // Match the tabs array specifically (not other strings in the file).
    const match = src.match(/const tabs = \[([\s\S]*?)\];/);
    assert.ok(match, "expected DealShell to define a tabs[] array");
    const tabsBlock = match![1];

    for (const label of REMOVED_STAGE_TABS) {
      assert.ok(
        !tabsBlock.includes(`label: "${label}"`),
        `tabs[] must not include stage-specific tab "${label}"`,
      );
    }
  });

  it("imports and renders JourneyRail", () => {
    assert.ok(src.includes('from "@/components/journey/JourneyRail"'));
    assert.ok(src.includes("<JourneyRail"));
    assert.ok(src.includes('variant="vertical"'));
    assert.ok(src.includes('variant="horizontal"'));
  });
});

describe("DealCockpitClient — SecondaryTabsPanel removed", () => {
  const src = fs.readFileSync(COCKPIT_CLIENT, "utf-8");

  it("does not mount <SecondaryTabsPanel", () => {
    assert.ok(
      !src.includes("<SecondaryTabsPanel"),
      "DealCockpitClient must not mount SecondaryTabsPanel (SPEC-01)",
    );
  });

  it("does not import SecondaryTabsPanel", () => {
    assert.ok(
      !/import\s*\{[^}]*SecondaryTabsPanel[^}]*\}\s*from/.test(src),
      "DealCockpitClient must not import SecondaryTabsPanel (SPEC-01)",
    );
  });
});
