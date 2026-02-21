/**
 * Matching Engine Tripwire Tests — CI-Blocking Structural Invariants
 *
 * Source-level invariants: pure core, lifecycle isolation, version defined,
 * no sort-order selection, no FINANCIAL_STATEMENT equivalence.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const MATCHING = path.join(process.cwd(), "src/lib/intake/matching");
const ARTIFACTS = path.join(process.cwd(), "src/lib/artifacts");

function readMatch(file: string): string {
  return fs.readFileSync(path.join(MATCHING, file), "utf8");
}

// ─── 1. matchEngine.ts does NOT import "server-only" ──────────────────────

test("Tripwire: matchEngine.ts is pure (no server-only)", () => {
  const src = readMatch("matchEngine.ts");
  assert.ok(
    !src.includes('"server-only"'),
    "matchEngine.ts must NOT import server-only — pure module",
  );
});

// ─── 2. matchEngine.ts does NOT import supabaseAdmin ──────────────────────

test("Tripwire: matchEngine.ts does NOT import supabaseAdmin", () => {
  const src = readMatch("matchEngine.ts");
  assert.ok(
    !src.includes("supabaseAdmin"),
    "matchEngine.ts must NOT import supabaseAdmin — pure module",
  );
});

// ─── 3. constraints.ts does NOT import "server-only" ──────────────────────

test("Tripwire: constraints.ts is pure (no server-only)", () => {
  const src = readMatch("constraints.ts");
  assert.ok(
    !src.includes('"server-only"'),
    "constraints.ts must NOT import server-only — pure module",
  );
});

// ─── 4. negativeRules.ts does NOT import "server-only" ────────────────────

test("Tripwire: negativeRules.ts is pure (no server-only)", () => {
  const src = readMatch("negativeRules.ts");
  assert.ok(
    !src.includes('"server-only"'),
    "negativeRules.ts must NOT import server-only — pure module",
  );
});

// ─── 5. runMatch.ts MUST import "server-only" ─────────────────────────────

test("Tripwire: runMatch.ts imports server-only", () => {
  const src = readMatch("runMatch.ts");
  assert.ok(
    src.includes('"server-only"'),
    "runMatch.ts MUST import server-only — DB layer",
  );
});

// ─── 6. MATCHING_ENGINE_VERSION defined and starts with "v" ───────────────

test("Tripwire: MATCHING_ENGINE_VERSION defined and starts with 'v'", () => {
  const src = readMatch("types.ts");
  const match = src.match(/MATCHING_ENGINE_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(match, "MATCHING_ENGINE_VERSION must be defined");
  assert.ok(
    match![1].startsWith("v"),
    `MATCHING_ENGINE_VERSION must start with 'v', got: ${match![1]}`,
  );
});

// ─── 7. Negative rules count ≥ 10 ────────────────────────────────────────

test("Tripwire: Negative rules count ≥ 10", () => {
  const src = readMatch("negativeRules.ts");
  const ruleMatches = [...src.matchAll(/ruleId:\s*"([^"]+)"/g)];
  assert.ok(
    ruleMatches.length >= 10,
    `Expected ≥ 10 negative rules, found ${ruleMatches.length}`,
  );
});

// ─── 8. processArtifact.ts calls runMatchForDocument ──────────────────────

test("Tripwire: processArtifact calls runMatchForDocument", () => {
  const src = fs.readFileSync(
    path.join(ARTIFACTS, "processArtifact.ts"),
    "utf8",
  );
  assert.ok(
    src.includes("runMatchForDocument"),
    "processArtifact must call runMatchForDocument",
  );
});

// ─── 9. runMatch.ts calls writeEvent ──────────────────────────────────────

test("Tripwire: runMatch.ts calls writeEvent", () => {
  const src = readMatch("runMatch.ts");
  assert.ok(
    src.includes("writeEvent"),
    "runMatch.ts must call writeEvent for ledger",
  );
});

// ─── 10. Pure files have no Math.random or Date.now in function bodies ────

test("Tripwire: pure modules have no non-deterministic calls", () => {
  const pureFiles = ["constraints.ts", "negativeRules.ts", "confidenceGate.ts", "identity.ts"];
  for (const file of pureFiles) {
    const src = readMatch(file);
    assert.ok(
      !src.includes("Math.random"),
      `${file} must not use Math.random — determinism invariant`,
    );
    assert.ok(
      !src.includes("Date.now"),
      `${file} must not use Date.now — determinism invariant`,
    );
  }
});

// ─── 11. FINANCIAL_STATEMENT not in equivalence map values ────────────────

test("Tripwire: FINANCIAL_STATEMENT not in equivalence map values", () => {
  const src = readMatch("constraints.ts");
  // Find the DOC_TYPE_EQUIVALENCE block
  const eqStart = src.indexOf("DOC_TYPE_EQUIVALENCE");
  const eqEnd = src.indexOf("};", eqStart);
  assert.ok(eqStart > -1 && eqEnd > eqStart, "Should find DOC_TYPE_EQUIVALENCE");
  const eqBlock = src.slice(eqStart, eqEnd);

  // FINANCIAL_STATEMENT should NOT appear as a key in the equivalence map
  const keys = [...eqBlock.matchAll(/^\s+(\w+):/gm)];
  for (const k of keys) {
    assert.notEqual(
      k[1],
      "FINANCIAL_STATEMENT",
      "FINANCIAL_STATEMENT must NOT be a key in the equivalence map",
    );
  }

  // Also check it's not a value in any array
  const values = [...eqBlock.matchAll(/"\w+"/g)];
  for (const v of values) {
    assert.notEqual(
      v[0],
      '"FINANCIAL_STATEMENT"',
      "FINANCIAL_STATEMENT must NOT be a value in the equivalence map",
    );
  }
});

// ─── 12. matchEngine.ts does NOT reference sortOrder for selection ─────────

test("Tripwire: matchEngine.ts does not use sortOrder for candidate selection", () => {
  const src = readMatch("matchEngine.ts");
  assert.ok(
    !src.includes("sortOrder"),
    "matchEngine.ts must NOT reference sortOrder — no heuristic selection",
  );
  assert.ok(
    !src.includes("sort_order"),
    "matchEngine.ts must NOT reference sort_order — no heuristic selection",
  );
});

// ---------------------------------------------------------------------------
// v1.1 Tripwires — Period, Entity, and Constraint Invariants
// ---------------------------------------------------------------------------

const IDENTITY = path.join(process.cwd(), "src/lib/intake/identity");

function readIdentity(file: string): string {
  return fs.readFileSync(path.join(IDENTITY, file), "utf8");
}

// ─── 13. MATCHING_ENGINE_VERSION starts with "v1.2" ─────────────────────

test("Tripwire v1.2: MATCHING_ENGINE_VERSION starts with 'v1.2'", () => {
  const src = readMatch("types.ts");
  const match = src.match(/MATCHING_ENGINE_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(match, "MATCHING_ENGINE_VERSION must be defined");
  assert.ok(
    match![1].startsWith("v1.2"),
    `MATCHING_ENGINE_VERSION must start with 'v1.2', got: ${match![1]}`,
  );
});

// ─── 14. extractPeriod.ts does NOT import "server-only" ─────────────────

test("Tripwire v1.1: extractPeriod.ts is pure (no server-only)", () => {
  const src = readIdentity("extractPeriod.ts");
  assert.ok(
    !src.includes('"server-only"'),
    "extractPeriod.ts must NOT import server-only — pure module",
  );
});

// ─── 15. entityResolver.ts does NOT import "server-only" ────────────────

test("Tripwire v1.1: entityResolver.ts is pure (no server-only import)", () => {
  const src = readIdentity("entityResolver.ts");
  assert.ok(
    !(/import\s+["']server-only["']/.test(src)),
    "entityResolver.ts must NOT import server-only — pure module",
  );
});

// ─── 16. resolveDocumentEntity.ts DOES import "server-only" ─────────────

test("Tripwire v1.1: resolveDocumentEntity.ts imports server-only", () => {
  const src = readIdentity("resolveDocumentEntity.ts");
  assert.ok(
    src.includes('"server-only"'),
    "resolveDocumentEntity.ts MUST import server-only — DB layer",
  );
});

// ─── 17. not_multi_year constraint name present in constraints.ts ───────

test("Tripwire v1.1: not_multi_year constraint present in constraints.ts", () => {
  const src = readMatch("constraints.ts");
  assert.ok(
    src.includes('"not_multi_year"'),
    'constraints.ts must contain "not_multi_year" constraint name',
  );
});

// ─── 18. entity_id_match constraint name present in constraints.ts ──────

test("Tripwire v1.1: entity_id_match constraint present in constraints.ts", () => {
  const src = readMatch("constraints.ts");
  assert.ok(
    src.includes('"entity_id_match"'),
    'constraints.ts must contain "entity_id_match" constraint name',
  );
});

// ─── 19. checkEntityAmbiguity function present in confidenceGate.ts ─────

test("Tripwire v1.1: checkEntityAmbiguity function in confidenceGate.ts", () => {
  const src = readMatch("confidenceGate.ts");
  assert.ok(
    src.includes("checkEntityAmbiguity"),
    "confidenceGate.ts must export checkEntityAmbiguity function",
  );
});
