/**
 * Phase 54B — Borrower Guidance Engine CI Guard
 *
 * Suites:
 * 1. Guidance engine contract
 * 2. Readiness honesty guard
 * 3. Placeholder regression
 * 4. Auth-boundary preservation
 * 5. Status explanation coverage
 * 6. Banker friction insight contract
 * 7. Prioritizer contract
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

function globSync(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const absDir = path.join(SRC_ROOT, dir);
  if (!fs.existsSync(absDir)) return results;
  const entries = fs.readdirSync(absDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    if (entry.isFile() && pattern.test(entry.name)) results.push(full);
  }
  return results;
}

// ---------------------------------------------------------------------------
// 1. Guidance engine contract
// ---------------------------------------------------------------------------

describe("Guidance engine — existence and contract", () => {
  it("deriveBorrowerGuidance exists", () => {
    assert.ok(fileExists("lib/borrower/guidance/deriveBorrowerGuidance.ts"));
  });

  it("returns stable payload shape", () => {
    const content = readFile("lib/borrower/guidance/deriveBorrowerGuidance.ts");
    assert.ok(content.includes("primaryNextAction"), "must return primaryNextAction");
    assert.ok(content.includes("secondaryActions"), "must return secondaryActions");
    assert.ok(content.includes("readiness"), "must return readiness");
    assert.ok(content.includes("conditionGuidance"), "must return conditionGuidance");
    assert.ok(content.includes("blockers"), "must return blockers");
    assert.ok(content.includes("milestones"), "must return milestones");
  });

  it("composes all sub-engines", () => {
    const content = readFile("lib/borrower/guidance/deriveBorrowerGuidance.ts");
    assert.ok(content.includes("deriveConditionStatus"), "must use status derivation");
    assert.ok(content.includes("explainConditionForBorrower"), "must use explanation engine");
    assert.ok(content.includes("prioritizeBorrowerActions"), "must use prioritizer");
    assert.ok(content.includes("calculateBorrowerReadiness"), "must use readiness calculator");
  });
});

// ---------------------------------------------------------------------------
// 2. Readiness honesty guard
// ---------------------------------------------------------------------------

describe("Readiness honesty guard", () => {
  const FORBIDDEN_IN_BORROWER = ["approved", "guaranteed", "pre-approved", "you qualify"];

  it("readiness labels do not imply approval certainty", () => {
    const content = readFile("lib/borrower/guidance/calculateBorrowerReadiness.ts");
    for (const word of FORBIDDEN_IN_BORROWER) {
      assert.ok(
        !content.toLowerCase().includes(word),
        `readiness module must not contain "${word}" — implies approval certainty`,
      );
    }
  });

  it("guidance engine does not imply approval certainty", () => {
    const content = readFile("lib/borrower/guidance/deriveBorrowerGuidance.ts");
    for (const word of FORBIDDEN_IN_BORROWER) {
      assert.ok(
        !content.toLowerCase().includes(word),
        `guidance engine must not contain "${word}"`,
      );
    }
  });

  it("borrower guidance UI does not imply approval certainty", () => {
    const content = readFile("components/borrower/BorrowerGuidancePanel.tsx");
    for (const word of FORBIDDEN_IN_BORROWER) {
      assert.ok(
        !content.toLowerCase().includes(word),
        `guidance UI must not contain "${word}"`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Placeholder regression
// ---------------------------------------------------------------------------

describe("Guidance — no placeholder copy", () => {
  it("guidance modules have no TODO/placeholder markers", () => {
    const guidanceFiles = globSync("lib/borrower/guidance", /\.ts$/);
    const violations: string[] = [];

    for (const file of guidanceFiles) {
      if (file.includes("__tests__")) continue;
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bTODO\b|placeholder|coming soon/i.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          violations.push(`${path.relative(SRC_ROOT, file)}:${i + 1}`);
        }
      }
    }

    assert.deepStrictEqual(violations, [], `Placeholder markers in guidance modules:\n${violations.join("\n")}`);
  });
});

// ---------------------------------------------------------------------------
// 4. Auth-boundary preservation
// ---------------------------------------------------------------------------

describe("Guidance API — auth boundary", () => {
  it("guidance API route uses borrower token auth", () => {
    const content = readFile("app/api/portal/[token]/guidance/route.ts");
    assert.ok(content.includes("borrower_portal_links"), "must validate token");
    assert.ok(!content.includes("clerkAuth"), "must NOT use Clerk auth");
  });
});

// ---------------------------------------------------------------------------
// 5. Status explanation coverage
// ---------------------------------------------------------------------------

describe("Explanation engine — status coverage", () => {
  it("explains all 7 canonical statuses", () => {
    const content = readFile("lib/borrower/guidance/explainConditionForBorrower.ts");
    const required = ["pending", "submitted", "under_review", "partially_satisfied", "satisfied", "rejected", "waived"];
    for (const status of required) {
      assert.ok(
        content.includes(`case "${status}"`),
        `explanation engine must handle "${status}" status`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Banker friction insights
// ---------------------------------------------------------------------------

describe("Banker friction insights — contract", () => {
  it("deriveBorrowerFrictionInsights exists", () => {
    assert.ok(fileExists("lib/borrower/guidance/deriveBorrowerFrictionInsights.ts"));
  });

  it("returns stable shape", () => {
    const content = readFile("lib/borrower/guidance/deriveBorrowerFrictionInsights.ts");
    assert.ok(content.includes("topFrictionConditions"), "must return friction conditions");
    assert.ok(content.includes("repeatedRejectionCount"), "must return rejection count");
    assert.ok(content.includes("waitingOnBankReview"), "must return bank wait indicator");
    assert.ok(content.includes("likelyConfusedBorrower"), "must return confusion indicator");
    assert.ok(content.includes("currentBorrowerNextAction"), "must return current action");
  });
});

// ---------------------------------------------------------------------------
// 7. Prioritizer contract
// ---------------------------------------------------------------------------

describe("Action prioritizer — contract", () => {
  it("prioritizeBorrowerActions exists", () => {
    assert.ok(fileExists("lib/borrower/guidance/prioritizeBorrowerActions.ts"));
  });

  it("returns one primary + bounded secondary actions", () => {
    const content = readFile("lib/borrower/guidance/prioritizeBorrowerActions.ts");
    assert.ok(content.includes("primary"), "must return primary action");
    assert.ok(content.includes("secondary"), "must return secondary actions");
    assert.ok(content.includes("slice(1, 4)"), "must cap secondary at 3");
  });

  it("handles wait state when no actionable items", () => {
    const content = readFile("lib/borrower/guidance/prioritizeBorrowerActions.ts");
    assert.ok(content.includes("wait_for_review"), "must handle all-under-review state");
  });
});
