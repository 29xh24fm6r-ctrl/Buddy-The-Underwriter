/**
 * Regression guard — no "moodys" / "Moody's" references in src/
 *
 * Scans the src/ tree (excluding node_modules, .next, .git) for any
 * case-insensitive match of "moodys" or "moody's". Fails if found.
 *
 * Allowed exceptions:
 * - This test file itself
 * - spreadTypeCompat.ts (runtime normalizer that must recognise the old DB value)
 * - render-diff/route.ts (DB compat query: .in("spread_type", ["STANDARD", "MOODYS"]))
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve("src");

const EXCLUDED_DIRS = new Set(["node_modules", ".next", ".git"]);

const ALLOWED_FILES = new Set([
  path.resolve("src/lib/financialSpreads/__tests__/noMoodysRegression.test.ts"),
  path.resolve("src/lib/financialSpreads/spreadTypeCompat.ts"),
  path.resolve("src/app/api/deals/[dealId]/model-v2/render-diff/route.ts"),
]);

function walk(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

describe("no moodys regression", () => {
  it("src/ contains zero case-insensitive 'moodys' or \"moody's\" references", () => {
    const pattern = /moody['']?s/i;
    const violations: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      if (ALLOWED_FILES.has(path.resolve(file))) continue;
      // Only scan text files
      if (!/\.(ts|tsx|js|jsx|json|md|txt|css|html)$/.test(file)) continue;

      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Found ${violations.length} "moodys"/"moody's" reference(s) in src/:\n${violations.join("\n")}`,
    );
  });
});
