/**
 * SPEC-BANKER-NOTES-TRANSCRIPT-1 — Guard tests
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FORM_SRC = readFileSync(
  resolve(__dirname, "../inputs/BorrowerStoryForm.tsx"), "utf-8",
);
const ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../../app/api/deals/[dealId]/memo-inputs/route.ts"), "utf-8",
);
const NOTES_ROUTE = resolve(
  __dirname, "../../../app/api/deals/[dealId]/relationship-notes/route.ts",
);

describe("SPEC-BANKER-NOTES-TRANSCRIPT-1 guards", () => {
  test("BorrowerStoryForm renders Extract from transcript button", () => {
    assert.ok(FORM_SRC.includes("Extract from transcript"));
  });

  test("memo-inputs route handles extract-transcript kind", () => {
    assert.ok(ROUTE_SRC.includes('"extract-transcript"'));
  });

  test("relationship notes API route exists", () => {
    assert.ok(existsSync(NOTES_ROUTE), "relationship-notes/route.ts must exist");
  });

  test("relationship notes API writes banker_relationship_notes", () => {
    const notesSrc = readFileSync(NOTES_ROUTE, "utf-8");
    assert.ok(notesSrc.includes("banker_relationship_notes"));
  });
});
