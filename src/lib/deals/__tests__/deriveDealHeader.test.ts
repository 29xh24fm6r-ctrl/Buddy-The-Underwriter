/**
 * Unit tests for deriveDealHeader — cockpit header title + "needs name" logic.
 *
 * Test 1: Header uses display_name when present (no "Needs name" badge)
 * Test 2: Header falls back to name, then to fallback ID slug
 *
 * Run: npx tsx src/lib/deals/__tests__/deriveDealHeader.test.ts
 */

import { deriveDealHeader } from "@/lib/deals/deriveDealHeader";
import assert from "node:assert/strict";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

const DEAL_ID = "a1b2c3d4-5678-9012-3456-789012345678";
const FALLBACK = `Deal ${DEAL_ID.slice(0, 8)}`;

// ─── Test 1: display_name present → title = display_name, needsName = false ──

console.log("deriveDealHeader — display_name present");

test("shows display_name as title", () => {
  const result = deriveDealHeader(DEAL_ID, {
    display_name: "Harbor Point LLC",
    name: "Some other name",
  });
  assert.equal(result.title, "Harbor Point LLC");
  assert.equal(result.needsName, false);
});

test("prefers display_name over name", () => {
  const result = deriveDealHeader(DEAL_ID, {
    display_name: "Primary Name",
    name: "Fallback Name",
  });
  assert.equal(result.title, "Primary Name");
  assert.equal(result.needsName, false);
});

// ─── Test 2: Fallback chain — name → fallback slug ──────────────────────────

console.log("deriveDealHeader — fallback chain");

test("falls back to name when display_name is null", () => {
  const result = deriveDealHeader(DEAL_ID, {
    display_name: null,
    name: "Derived Deal Name",
  });
  assert.equal(result.title, "Derived Deal Name");
  assert.equal(result.needsName, false);
});

test("falls back to name when display_name is whitespace", () => {
  const result = deriveDealHeader(DEAL_ID, {
    display_name: "   ",
    name: "Real Name",
  });
  assert.equal(result.title, "Real Name");
  assert.equal(result.needsName, false);
});

test("shows fallback slug when both null", () => {
  const result = deriveDealHeader(DEAL_ID, {
    display_name: null,
    name: null,
  });
  assert.equal(result.title, FALLBACK);
  assert.equal(result.needsName, true);
});

test("shows fallback slug when both whitespace", () => {
  const result = deriveDealHeader(DEAL_ID, {
    display_name: "   ",
    name: "  ",
  });
  assert.equal(result.title, FALLBACK);
  assert.equal(result.needsName, true);
});

test("shows fallback slug when meta is null", () => {
  const result = deriveDealHeader(DEAL_ID, null);
  assert.equal(result.title, FALLBACK);
  assert.equal(result.needsName, true);
});

test("shows fallback slug when meta is undefined", () => {
  const result = deriveDealHeader(DEAL_ID, undefined);
  assert.equal(result.title, FALLBACK);
  assert.equal(result.needsName, true);
});

// ─── Auto-generated name filtering ──────────────────────────────────────────

console.log("deriveDealHeader — auto-generated name filtering");

test("filters auto-generated display_name but needsName=false (field is non-blank)", () => {
  const result = deriveDealHeader(DEAL_ID, {
    display_name: "Deal - 1/28/2026",
    name: null,
  });
  assert.equal(result.title, FALLBACK);
  assert.equal(result.needsName, false);
});

test("filters auto-generated name with UUID", () => {
  const result = deriveDealHeader(DEAL_ID, {
    display_name: null,
    name: "Deal a1b2c3d4-5678-9012-3456-789012345678",
  });
  assert.equal(result.title, FALLBACK);
  assert.equal(result.needsName, false);
});

test("filters 'New Deal' display_name", () => {
  const result = deriveDealHeader(DEAL_ID, {
    display_name: "New Deal",
    name: null,
  });
  assert.equal(result.title, FALLBACK);
  assert.equal(result.needsName, false);
});

test("uses name if display_name is auto-generated", () => {
  const result = deriveDealHeader(DEAL_ID, {
    display_name: "Pending Autofill",
    name: "Harbor Point LLC",
  });
  assert.equal(result.title, "Harbor Point LLC");
  assert.equal(result.needsName, false);
});

// ─── Rename prefill simulation ──────────────────────────────────────────────

console.log("deriveDealHeader — rename prefill");

test("after rename, display_name updates header", () => {
  // Before rename
  const before = deriveDealHeader(DEAL_ID, { display_name: null, name: null });
  assert.equal(before.title, FALLBACK);
  assert.equal(before.needsName, true);

  // After rename to "Riverside Commercial"
  const after = deriveDealHeader(DEAL_ID, { display_name: "Riverside Commercial", name: null });
  assert.equal(after.title, "Riverside Commercial");
  assert.equal(after.needsName, false);
});

console.log("\nAll deriveDealHeader tests complete.");
