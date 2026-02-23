/**
 * Naming Sync Guard
 *
 * CI guards verifying that applyDealDerivedNaming writes both `display_name`
 * AND `name` columns, preventing the "NEEDS NAME" UI bug.
 *
 * Uses source-code inspection to avoid server-only transitive deps.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const NAMING_PATH = path.resolve(
  __dirname,
  "../applyDealDerivedNaming.ts",
);

// ── Guard 1: Derived name update writes both display_name and name ───────────

test("Guard 1: Derived name update writes both display_name and name", () => {
  const src = fs.readFileSync(NAMING_PATH, "utf8");

  // Find the derived name update block (naming_method: "derived")
  const derivedIdx = src.indexOf('naming_method: "derived"');
  assert.ok(derivedIdx >= 0, "Must have a derived naming update block");

  // Look backwards to find the .update({ start
  const blockStart = src.lastIndexOf(".update({", derivedIdx);
  assert.ok(blockStart >= 0, "Must find the update call before naming_method: derived");

  const updateBlock = src.substring(blockStart, derivedIdx + 50);

  assert.ok(
    updateBlock.includes("display_name:"),
    "Derived name update must set display_name",
  );
  assert.ok(
    updateBlock.includes("name:"),
    "Derived name update must set name column (prevents NEEDS NAME bug)",
  );
});

// ── Guard 2: Fallback name update writes both display_name and name ──────────

test("Guard 2: Fallback name update writes both display_name and name", () => {
  const src = fs.readFileSync(NAMING_PATH, "utf8");

  // Find the fallback name update block (naming_method: "fallback")
  const fallbackIdx = src.indexOf('naming_method: "fallback"');
  assert.ok(fallbackIdx >= 0, "Must have a fallback naming update block");

  // Look backwards to find the .update({ start
  const blockStart = src.lastIndexOf(".update({", fallbackIdx);
  assert.ok(blockStart >= 0, "Must find the update call before naming_method: fallback");

  const updateBlock = src.substring(blockStart, fallbackIdx + 50);

  assert.ok(
    updateBlock.includes("display_name:"),
    "Fallback name update must set display_name",
  );
  assert.ok(
    updateBlock.includes("name:"),
    "Fallback name update must set name column (prevents NEEDS NAME bug)",
  );
});

// ── Guard 3: Both update sites include sync comment ─────────────────────────

test("Guard 3: Both update sites have sync documentation", () => {
  const src = fs.readFileSync(NAMING_PATH, "utf8");

  // Count occurrences of the sync comment
  const syncCommentCount = (src.match(/Sync name column/g) ?? []).length;
  assert.ok(
    syncCommentCount >= 2,
    `Must have at least 2 'Sync name column' comments (found ${syncCommentCount}) — one per update site`,
  );
});
