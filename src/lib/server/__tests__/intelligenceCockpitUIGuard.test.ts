/**
 * Phase 59 — Intelligence Cockpit UI CI Guard
 *
 * Suites:
 * 1. Polling hook contract
 * 2. IntelligencePanel contract
 * 3. IntelligenceStep contract
 * 4. DealCockpitClient integration
 * 5. Copy quality
 * 6. Placeholder regression
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(SRC_ROOT, relPath));
}

// ---------------------------------------------------------------------------
// 1. Polling hook
// ---------------------------------------------------------------------------

describe("useAutoIntelligence hook — contract", () => {
  it("hook exists", () => {
    assert.ok(fileExists("lib/hooks/useAutoIntelligence.ts"));
  });

  it("polls intelligence API", () => {
    const content = readFile("lib/hooks/useAutoIntelligence.ts");
    assert.ok(content.includes("/api/deals/") && content.includes("intelligence/auto"),
      "must poll intelligence endpoint");
  });

  it("exposes isRunning + isReady + isFailed + retry", () => {
    const content = readFile("lib/hooks/useAutoIntelligence.ts");
    assert.ok(content.includes("isRunning"), "must expose isRunning");
    assert.ok(content.includes("isReady"), "must expose isReady");
    assert.ok(content.includes("isFailed"), "must expose isFailed");
    assert.ok(content.includes("retry"), "must expose retry function");
  });

  it("stops polling when complete", () => {
    const content = readFile("lib/hooks/useAutoIntelligence.ts");
    assert.ok(content.includes("clearInterval"), "must stop polling on completion");
  });
});

// ---------------------------------------------------------------------------
// 2. IntelligencePanel
// ---------------------------------------------------------------------------

describe("IntelligencePanel — contract", () => {
  it("component exists", () => {
    assert.ok(fileExists("components/deal/IntelligencePanel.tsx"));
  });

  it("renders running state with alive messaging", () => {
    const content = readFile("components/deal/IntelligencePanel.tsx");
    assert.ok(content.includes("Buddy is analyzing this deal"), "must show alive running message");
  });

  it("renders completed state", () => {
    const content = readFile("components/deal/IntelligencePanel.tsx");
    assert.ok(content.includes("Buddy has analyzed this deal"), "must show completion message");
  });

  it("renders failure state with retry", () => {
    const content = readFile("components/deal/IntelligencePanel.tsx");
    assert.ok(content.includes("Analysis needs attention"), "must show failure message");
    assert.ok(content.includes("Retry"), "must show retry button");
  });

  it("renders waiting state when no run exists", () => {
    const content = readFile("components/deal/IntelligencePanel.tsx");
    assert.ok(content.includes("Waiting for documents"), "must show waiting state");
  });

  it("uses human-readable step labels", () => {
    const content = readFile("components/deal/IntelligencePanel.tsx");
    assert.ok(content.includes("Analyzing financial documents"), "must have human label for facts");
    assert.ok(content.includes("Building deal snapshot"), "must have human label for snapshot");
    assert.ok(content.includes("Finding matching lenders"), "must have human label for lenders");
    assert.ok(content.includes("Evaluating risk profile"), "must have human label for risk");
  });
});

// ---------------------------------------------------------------------------
// 3. IntelligenceStep
// ---------------------------------------------------------------------------

describe("IntelligenceStep — contract", () => {
  it("component exists", () => {
    assert.ok(fileExists("components/deal/IntelligenceStep.tsx"));
  });

  it("handles all status types", () => {
    const content = readFile("components/deal/IntelligenceStep.tsx");
    for (const s of ["queued", "running", "succeeded", "failed", "skipped"]) {
      assert.ok(content.includes(s), `must handle "${s}" status`);
    }
  });

  it("animates running state", () => {
    const content = readFile("components/deal/IntelligenceStep.tsx");
    assert.ok(content.includes("animate"), "must animate running step");
  });
});

// ---------------------------------------------------------------------------
// 4. DealCockpitClient integration
// ---------------------------------------------------------------------------

describe("DealCockpitClient — intelligence panel integration", () => {
  it("imports IntelligencePanel", () => {
    const content = readFile("components/deals/DealCockpitClient.tsx");
    assert.ok(content.includes("IntelligencePanel"), "must import IntelligencePanel");
  });

  it("renders IntelligencePanel above tabs", () => {
    const content = readFile("components/deals/DealCockpitClient.tsx");
    const panelIdx = content.indexOf("<IntelligencePanel");
    const heroIdx = content.indexOf("Hero Header");
    assert.ok(panelIdx < heroIdx, "IntelligencePanel must render before hero header");
  });
});

// ---------------------------------------------------------------------------
// 5. Copy quality
// ---------------------------------------------------------------------------

describe("Intelligence UI — copy quality", () => {
  it("does not use generic 'Processing' language", () => {
    const panel = readFile("components/deal/IntelligencePanel.tsx");
    const step = readFile("components/deal/IntelligenceStep.tsx");
    const combined = panel + step;
    // Should use specific language, not generic
    assert.ok(!combined.includes('"Processing"') && !combined.includes('"Processing..."'),
      "should use specific language, not generic 'Processing'");
  });
});

// ---------------------------------------------------------------------------
// 6. Placeholder regression
// ---------------------------------------------------------------------------

describe("Intelligence cockpit UI — no placeholders", () => {
  it("components have no placeholder markers", () => {
    const files = [
      "components/deal/IntelligencePanel.tsx",
      "components/deal/IntelligenceStep.tsx",
      "lib/hooks/useAutoIntelligence.ts",
    ];
    for (const f of files) {
      const content = readFile(f);
      assert.ok(!content.includes("alert("), `${f} must not use alert()`);
      assert.ok(!/coming soon/i.test(content), `${f} must not contain 'Coming Soon'`);
    }
  });
});
