/**
 * No Soft Skip Allowed — v1.4.0 CI Guard
 *
 * Ensures all E3.3 soft-skip artifacts have been fully removed
 * from the matching engine codebase. Any remnant is a regression.
 *
 * Fail if any of these appear in matching engine source:
 *   - "skipped"             (meta.skipped pattern)
 *   - "entity_constraint_skipped"
 *   - "entity_null"         (soft-skip reason)
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const MATCHING_DIR = path.resolve("src/lib/intake/matching");

// Read source files (excluding __tests__ directory)
const sourceFiles = fs
  .readdirSync(MATCHING_DIR)
  .filter((f) => f.endsWith(".ts") && !f.startsWith("__"))
  .map((f) => ({
    name: f,
    content: fs.readFileSync(path.join(MATCHING_DIR, f), "utf-8"),
  }));

test("[guard] no 'entity_constraint_skipped' in matching engine source", () => {
  for (const file of sourceFiles) {
    assert.ok(
      !file.content.includes("entity_constraint_skipped"),
      `${file.name} contains "entity_constraint_skipped" — E3.3 artifact must be removed`,
    );
  }
});

test("[guard] no 'meta.skipped' pattern in matching engine source", () => {
  for (const file of sourceFiles) {
    // Match meta?.skipped or meta.skipped but not in test descriptions
    const hasSkipMeta = /meta\??\.\s*skipped/.test(file.content);
    assert.ok(
      !hasSkipMeta,
      `${file.name} contains meta.skipped pattern — E3.3 artifact must be removed`,
    );
  }
});

test("[guard] no 'entity_null' soft-skip reason in matching engine source", () => {
  for (const file of sourceFiles) {
    // Match reason: "entity_null" but not in comments/descriptions
    const hasEntityNull = /reason:\s*["']entity_null["']/.test(file.content);
    assert.ok(
      !hasEntityNull,
      `${file.name} contains reason: "entity_null" — E3.3 artifact must be removed`,
    );
  }
});

test("[guard] no 'skipped: true' pattern in constraint results", () => {
  const constraintsSrc = sourceFiles.find((f) => f.name === "constraints.ts");
  assert.ok(constraintsSrc, "constraints.ts must exist");
  assert.ok(
    !constraintsSrc.content.includes("skipped: true"),
    "constraints.ts contains 'skipped: true' — E3.3 artifact must be removed",
  );
});

test("[guard] MATCHING_ENGINE_VERSION is v1.4.0", () => {
  const typesSrc = sourceFiles.find((f) => f.name === "types.ts");
  assert.ok(typesSrc, "types.ts must exist");
  assert.ok(
    typesSrc.content.includes('"v1.4.0"'),
    "types.ts must contain MATCHING_ENGINE_VERSION = v1.4.0",
  );
});

test("[guard] identity_not_ambiguous constraint exists in constraints.ts", () => {
  const constraintsSrc = sourceFiles.find((f) => f.name === "constraints.ts");
  assert.ok(constraintsSrc, "constraints.ts must exist");
  assert.ok(
    constraintsSrc.content.includes("identity_not_ambiguous"),
    "constraints.ts must contain identity_not_ambiguous constraint",
  );
});
