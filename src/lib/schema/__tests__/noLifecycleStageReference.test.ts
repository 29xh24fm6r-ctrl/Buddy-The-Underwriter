/**
 * CI Guard — No lifecycle_stage references in source code.
 *
 * Production DB has `deals.stage`, NOT `deals.lifecycle_stage`.
 * The migration adding lifecycle_stage was never applied.
 * Any code referencing lifecycle_stage will cause PostgREST error 42703.
 *
 * This guard permanently prevents schema drift recurrence.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(__dirname, "../../..");
const SELF = relative(SRC_ROOT, __filename);

/**
 * Allowlist: files that legitimately reference "lifecycle_stage" as part of
 * a DIFFERENT column name (e.g. lifecycle_stage_at_launch on
 * underwriting_launch_snapshots) or in a test FORBIDDEN-list assertion.
 */
const ALLOWED_FILES = new Set([
  "app/api/deals/[dealId]/launch-underwriting/route.ts",       // lifecycle_stage_at_launch column
  "app/api/deals/[dealId]/underwrite/state/route.ts",          // reads lifecycle_stage_at_launch
  "lib/__tests__/phase65ACanonicalBoundary.test.ts",           // FORBIDDEN-list assertion
]);

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      results.push(...collectTsFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

describe("Schema drift guard: no lifecycle_stage references", () => {
  const files = collectTsFiles(SRC_ROOT);

  test("no source file in src/ references lifecycle_stage", () => {
    const violations: string[] = [];

    for (const filePath of files) {
      const rel = relative(SRC_ROOT, filePath);
      if (rel === SELF) continue; // exclude this guard file
      if (ALLOWED_FILES.has(rel)) continue; // legitimate non-deals column refs

      const content = readFileSync(filePath, "utf-8");
      if (content.includes("lifecycle_stage")) {
        violations.push(rel);
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Found lifecycle_stage references in: ${violations.join(", ")}. ` +
        `Production DB uses deals.stage — lifecycle_stage does not exist.`,
    );
  });

  test("guard scans at least 100 files (sanity check)", () => {
    assert.ok(
      files.length > 100,
      `Expected >100 .ts/.tsx files in src/, found ${files.length}`,
    );
  });
});
