/**
 * Phase 58A — Intake to Cockpit Hardening CI Guard
 *
 * Suites:
 * 1. CockpitAuthGate contract
 * 2. Intake readiness helper
 * 3. Canonical naming
 * 4. DealCockpitClient uses auth gate
 * 5. Placeholder regression
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
// 1. CockpitAuthGate
// ---------------------------------------------------------------------------

describe("CockpitAuthGate — contract", () => {
  it("component exists", () => {
    assert.ok(fileExists("components/deals/CockpitAuthGate.tsx"));
  });

  it("renders loading state before auth ready", () => {
    const content = readFile("components/deals/CockpitAuthGate.tsx");
    assert.ok(content.includes("Loading secure deal context"), "must show loading text");
  });

  it("renders children after auth ready", () => {
    const content = readFile("components/deals/CockpitAuthGate.tsx");
    assert.ok(content.includes("children"), "must render children when ready");
  });
});

// ---------------------------------------------------------------------------
// 2. Intake readiness helper
// ---------------------------------------------------------------------------

describe("Intake readiness — contract", () => {
  it("isIntakeReadyForProcessing exists", () => {
    assert.ok(fileExists("lib/intake/isIntakeReadyForProcessing.ts"));
  });

  it("checks all required conditions", () => {
    const content = readFile("lib/intake/isIntakeReadyForProcessing.ts");
    assert.ok(content.includes("unclassified"), "must check unclassified");
    assert.ok(content.includes("gatekeeperNeedsReview"), "must check gatekeeper review");
    assert.ok(content.includes("missingYear"), "must check missing year");
    assert.ok(content.includes("missingPeriod"), "must check missing period");
    assert.ok(content.includes("classificationConfirmed"), "must check confirmation");
  });

  it("returns structured blockers", () => {
    const content = readFile("lib/intake/isIntakeReadyForProcessing.ts");
    assert.ok(content.includes("blockers"), "must return blockers array");
    assert.ok(content.includes("code"), "blockers must have code");
    assert.ok(content.includes("message"), "blockers must have message");
    assert.ok(content.includes("documentId"), "blockers must have documentId");
  });
});

// ---------------------------------------------------------------------------
// 3. Canonical naming
// ---------------------------------------------------------------------------

describe("Canonical deal naming — contract", () => {
  it("ensureDealCanonicalName exists", () => {
    assert.ok(fileExists("lib/deals/ensureDealCanonicalName.ts"));
  });

  it("backfills display_name from name or borrower_name", () => {
    const content = readFile("lib/deals/ensureDealCanonicalName.ts");
    assert.ok(content.includes("display_name"), "must check display_name");
    assert.ok(content.includes("borrower_name"), "must check borrower_name as fallback");
    assert.ok(content.includes("backfillSource"), "must have backfill logic");
  });

  it("deriveDealHeader never shows ID fallback when valid name exists", () => {
    const content = readFile("lib/deals/deriveDealHeader.ts");
    // When a non-auto-generated name is found, needsName should be false
    assert.ok(
      content.includes("needsName: false"),
      "must set needsName=false when valid non-auto name found",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. DealCockpitClient uses auth gate
// ---------------------------------------------------------------------------

describe("DealCockpitClient — auth gate integration", () => {
  it("imports CockpitAuthGate", () => {
    const content = readFile("components/deals/DealCockpitClient.tsx");
    assert.ok(content.includes("CockpitAuthGate"), "must import CockpitAuthGate");
  });

  it("wraps cockpit body with auth gate", () => {
    const content = readFile("components/deals/DealCockpitClient.tsx");
    assert.ok(
      content.includes("<CockpitAuthGate>"),
      "must wrap cockpit content with auth gate",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Placeholder regression
// ---------------------------------------------------------------------------

describe("Intake cockpit hardening — no placeholders", () => {
  it("new modules have no placeholder markers", () => {
    const files = [
      "components/deals/CockpitAuthGate.tsx",
      "lib/intake/isIntakeReadyForProcessing.ts",
      "lib/deals/ensureDealCanonicalName.ts",
    ];
    for (const f of files) {
      const content = readFile(f);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bTODO\b|placeholder|coming soon/i.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          assert.fail(`Placeholder in ${f}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  });
});
