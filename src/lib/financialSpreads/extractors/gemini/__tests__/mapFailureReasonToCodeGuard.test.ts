/**
 * SPEC-GEMINI-EXTRACTION-CONFIG-FIX-1 §3.2 — source-grep guard.
 *
 * Verifies geminiDocumentExtractor.ts maps the `empty_response*` failure
 * reasons to STRUCTURED_EMPTY_RESPONSE and orders the branch before the
 * `invalid` / `json` branches (so a suffix like `:MAX_TOKENS` doesn't
 * accidentally match the JSON branch).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(
  process.cwd(),
  "src/lib/financialSpreads/extractors/gemini/geminiDocumentExtractor.ts",
);
const SRC = readFileSync(FILE, "utf8");

test("[gemini-1] mapFailureReasonToCode handles empty_response before other branches", () => {
  const fnMatch = SRC.match(/function\s+mapFailureReasonToCode[\s\S]*?\n\}/);
  assert.ok(fnMatch, "mapFailureReasonToCode function not found");
  const body = fnMatch[0];

  const emptyIdx = body.indexOf('"empty_response"');
  const invalidIdx = body.indexOf('"invalid"');
  const jsonIdx = body.indexOf('"json"');

  assert.ok(emptyIdx > 0, "empty_response branch missing");
  assert.ok(
    emptyIdx < invalidIdx || invalidIdx === -1,
    "empty_response branch must precede 'invalid' branch",
  );
  assert.ok(
    emptyIdx < jsonIdx || jsonIdx === -1,
    "empty_response branch must precede 'json' branch",
  );
});

test("[gemini-2] mapFailureReasonToCode returns STRUCTURED_EMPTY_RESPONSE for empty_response", () => {
  assert.match(
    SRC,
    /empty_response[\s\S]*?return\s+"STRUCTURED_EMPTY_RESPONSE"/,
  );
});
