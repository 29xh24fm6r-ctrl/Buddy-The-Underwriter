import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ─── Structural tripwires: DOC_TYPE_EQUIVALENCES alignment ───────────────────
//
// Buddy invariants enforced:
//   1. FINANCIAL_STATEMENT umbrella maps to both IS and BS slots
//   2. FINANCIAL_STATEMENT does NOT map to PFS (semantic boundary)
//   3. T12 still maps to INCOME_STATEMENT (regression guard)
//   4. Equivalence arrays are consistent with auto-match routing
//
// These tests read the source file statically — no imports needed.
// validateSlotAttachment.ts has `import "server-only"` which blocks runtime import.

function readValidateSlotSource(): string {
  return fs.readFileSync(
    path.join(
      process.cwd(),
      "src/lib/intake/slots/validateSlotAttachment.ts",
    ),
    "utf8",
  );
}

/**
 * Extract DOC_TYPE_EQUIVALENCES from source and parse the array for a given key.
 * Returns the equivalence array entries or null if the key is not found.
 */
function extractEquivalenceArray(src: string, key: string): string[] | null {
  // Match: KEY: ["A", "B", "C"],
  const pattern = new RegExp(
    `${key}:\\s*\\[([^\\]]+)\\]`,
  );
  const match = src.match(pattern);
  if (!match) return null;

  // Parse the array contents — extract quoted strings
  const arrayContent = match[1];
  const entries = [...arrayContent.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return entries;
}

// ─── 1. FINANCIAL_STATEMENT maps to INCOME_STATEMENT slot ────────────────────

test("docTypesMatch(INCOME_STATEMENT, FINANCIAL_STATEMENT) → FINANCIAL_STATEMENT in IS equivalences", () => {
  const src = readValidateSlotSource();
  const isEquiv = extractEquivalenceArray(src, "INCOME_STATEMENT");

  assert.ok(isEquiv, "INCOME_STATEMENT must have an equivalence array");
  assert.ok(
    isEquiv.includes("FINANCIAL_STATEMENT"),
    `INCOME_STATEMENT equivalences must include FINANCIAL_STATEMENT, got: [${isEquiv.join(", ")}]`,
  );
});

// ─── 2. FINANCIAL_STATEMENT maps to BALANCE_SHEET slot ───────────────────────

test("docTypesMatch(BALANCE_SHEET, FINANCIAL_STATEMENT) → FINANCIAL_STATEMENT in BS equivalences", () => {
  const src = readValidateSlotSource();
  const bsEquiv = extractEquivalenceArray(src, "BALANCE_SHEET");

  assert.ok(bsEquiv, "BALANCE_SHEET must have an equivalence array");
  assert.ok(
    bsEquiv.includes("FINANCIAL_STATEMENT"),
    `BALANCE_SHEET equivalences must include FINANCIAL_STATEMENT, got: [${bsEquiv.join(", ")}]`,
  );
});

// ─── 3. FINANCIAL_STATEMENT does NOT map to PFS (semantic boundary) ──────────

test("PERSONAL_FINANCIAL_STATEMENT equivalences must NOT include FINANCIAL_STATEMENT", () => {
  const src = readValidateSlotSource();
  const pfsEquiv = extractEquivalenceArray(src, "PERSONAL_FINANCIAL_STATEMENT");

  assert.ok(pfsEquiv, "PERSONAL_FINANCIAL_STATEMENT must have an equivalence array");
  assert.ok(
    !pfsEquiv.includes("FINANCIAL_STATEMENT"),
    `PERSONAL_FINANCIAL_STATEMENT must NOT include FINANCIAL_STATEMENT (semantic boundary), got: [${pfsEquiv.join(", ")}]`,
  );
});

// ─── 4. T12 still maps to INCOME_STATEMENT (regression guard) ────────────────

test("T12 is in INCOME_STATEMENT equivalences (regression guard)", () => {
  const src = readValidateSlotSource();
  const isEquiv = extractEquivalenceArray(src, "INCOME_STATEMENT");

  assert.ok(isEquiv, "INCOME_STATEMENT must have an equivalence array");
  assert.ok(
    isEquiv.includes("T12"),
    `INCOME_STATEMENT equivalences must include T12, got: [${isEquiv.join(", ")}]`,
  );
});

// ─── 5. FINANCIAL_STATEMENT in both IS and BS (dual-presence tripwire) ───────

test("FINANCIAL_STATEMENT appears in BOTH IS and BS equivalence arrays", () => {
  const src = readValidateSlotSource();
  const isEquiv = extractEquivalenceArray(src, "INCOME_STATEMENT");
  const bsEquiv = extractEquivalenceArray(src, "BALANCE_SHEET");

  assert.ok(isEquiv, "INCOME_STATEMENT equivalence array must exist");
  assert.ok(bsEquiv, "BALANCE_SHEET equivalence array must exist");

  const inIS = isEquiv.includes("FINANCIAL_STATEMENT");
  const inBS = bsEquiv.includes("FINANCIAL_STATEMENT");

  assert.ok(
    inIS && inBS,
    `FINANCIAL_STATEMENT must be in BOTH IS and BS equivalences (IS: ${inIS}, BS: ${inBS})`,
  );
});
