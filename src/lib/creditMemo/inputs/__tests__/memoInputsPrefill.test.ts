/**
 * Memo Inputs Prefill — structural invariants.
 *
 * The prefill module is server-only (it reads from Supabase + research).
 * These tests verify the type contract and the file-level invariants:
 *   1. The exported function returns SuggestedValue entries with required fields
 *   2. SuggestedValue.confidence is bounded [0, 1]
 *   3. Banker-certified output is never emitted directly — every suggestion
 *      goes through Accept/Edit/Dismiss before becoming a row.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const PREFILL = join(REPO_ROOT, "src/lib/creditMemo/inputs/prefillMemoInputs.ts");
const TYPES = join(REPO_ROOT, "src/lib/creditMemo/inputs/prefillTypes.ts");

function read(p: string) {
  return readFileSync(p, "utf8");
}

test("[prefill-1] every suggestion has source / confidence / reason", () => {
  const body = read(TYPES);
  for (const field of ["source", "confidence", "reason"]) {
    assert.ok(
      body.includes(`${field}: `),
      `SuggestedValue must declare ${field}`,
    );
  }
});

test("[prefill-2] prefill module produces all three sections", () => {
  const body = read(PREFILL);
  assert.match(body, /buildBorrowerStorySuggestions/);
  assert.match(body, /buildManagementSuggestions/);
  assert.match(body, /buildCollateralSuggestions/);
});

test("[prefill-3] confidence is clamped to [0, 1] for collateral suggestions", () => {
  const body = read(PREFILL);
  assert.match(
    body,
    /clamp\([^)]+,\s*[\d.]+,\s*0\.99\)/,
    "Collateral confidence must use clamp(value, lo, hi) bounded under 1",
  );
});

test("[prefill-4] prefill never writes directly — ownership goes through accept", () => {
  const body = read(PREFILL);
  // Prefill is read-only by design. It must not call any upsert*.
  assert.ok(!/upsert(BorrowerStory|ManagementProfile|CollateralItem)\(/.test(body));
  // The ownership rule is in the docstring.
  assert.match(body, /accept|advisory/i);
});

test("[prefill-5] research narrative is the primary source for borrower story", () => {
  const body = read(PREFILL);
  assert.match(
    body,
    /research\.industry_overview/,
    "Borrower story prefill should preferentially use research narrative",
  );
});
