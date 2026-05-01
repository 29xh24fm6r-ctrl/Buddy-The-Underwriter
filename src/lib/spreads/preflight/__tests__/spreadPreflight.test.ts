import { test } from "node:test";
import assert from "node:assert/strict";

// Import from the pure module — server wrapper exercised in production via
// fire-and-forget ledger writes.
import {
  checkSpreadPreflight,
  type SpreadPreflightInput,
} from "../spreadPreflightPure";

const SOURCE_A = "11111111-1111-1111-1111-111111111111";
const SOURCE_B = "22222222-2222-2222-2222-222222222222";

const baseInput = (overrides: Partial<SpreadPreflightInput> = {}): SpreadPreflightInput => ({
  balanceSheetRowCount: 0,
  incomeStatementRowCount: 0,
  sourceDocuments: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Blocked cases
// ---------------------------------------------------------------------------

test("blocked: zero balance-sheet rows AND zero income-statement rows", () => {
  const result = checkSpreadPreflight(
    baseInput({ sourceDocuments: [SOURCE_A, SOURCE_B] }),
  );
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.reason, "missing_financial_facts");
    // Both sections + their canonical keys
    assert.deepEqual(result.missingFacts, [
      "BALANCE_SHEET",
      "TOTAL_ASSETS",
      "INCOME_STATEMENT",
      "REVENUE",
      "NET_INCOME",
    ]);
    assert.deepEqual(result.sourceDocuments, [SOURCE_A, SOURCE_B]);
    assert.match(result.userMessage, /Financial extraction completed/);
  }
});

test("blocked: balance sheet missing only (income statement present)", () => {
  const result = checkSpreadPreflight(
    baseInput({
      balanceSheetRowCount: 0,
      incomeStatementRowCount: 12,
      sourceDocuments: [SOURCE_A],
    }),
  );
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.deepEqual(result.missingFacts, ["BALANCE_SHEET", "TOTAL_ASSETS"]);
    assert.deepEqual(result.sourceDocuments, [SOURCE_A]);
  }
});

test("blocked: income statement missing only (balance sheet present)", () => {
  const result = checkSpreadPreflight(
    baseInput({
      balanceSheetRowCount: 8,
      incomeStatementRowCount: 0,
      sourceDocuments: [SOURCE_A],
    }),
  );
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.deepEqual(result.missingFacts, ["INCOME_STATEMENT", "REVENUE", "NET_INCOME"]);
  }
});

// ---------------------------------------------------------------------------
// Valid cases
// ---------------------------------------------------------------------------

test("ok: both sections have rows", () => {
  const result = checkSpreadPreflight(
    baseInput({
      balanceSheetRowCount: 8,
      incomeStatementRowCount: 12,
      sourceDocuments: [SOURCE_A],
    }),
  );
  assert.equal(result.status, "ok");
});

test("ok: minimum viable single row in each section", () => {
  const result = checkSpreadPreflight(
    baseInput({ balanceSheetRowCount: 1, incomeStatementRowCount: 1 }),
  );
  assert.equal(result.status, "ok");
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("blocked: negative row counts treated as 0", () => {
  // Defensive: negative counts shouldn't happen but if they do, block.
  const result = checkSpreadPreflight(
    baseInput({ balanceSheetRowCount: -1, incomeStatementRowCount: -5 }),
  );
  assert.equal(result.status, "blocked");
});

test("blocked payload carries empty sourceDocuments when none processed", () => {
  // Defines the contract for surfaces that haven't even uploaded yet.
  const result = checkSpreadPreflight(baseInput());
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.deepEqual(result.sourceDocuments, []);
  }
});

// ---------------------------------------------------------------------------
// Acceptance tests from the spec
// ---------------------------------------------------------------------------

test("acceptance: OmniCare-style deal (no balance sheet facts) blocks PDF generation", () => {
  // Mirrors the OmniCare deal state observed in production:
  // 0 BALANCE_SHEET facts, 10 INCOME_STATEMENT keys across 2 periods.
  const result = checkSpreadPreflight({
    balanceSheetRowCount: 0,    // zero BS rows because no facts
    incomeStatementRowCount: 22, // IS rows derived from extant facts
    sourceDocuments: [SOURCE_A, SOURCE_B],
  });
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.equal(result.reason, "missing_financial_facts");
    assert.ok(result.missingFacts.includes("BALANCE_SHEET"));
    assert.ok(result.missingFacts.includes("TOTAL_ASSETS"));
    assert.ok(!result.missingFacts.includes("INCOME_STATEMENT"));
    assert.ok(result.sourceDocuments.length > 0);
  }
});

test("acceptance: existing valid spread deal still renders", () => {
  // Both BS and IS populated — preflight must not regress these.
  const result = checkSpreadPreflight({
    balanceSheetRowCount: 14,
    incomeStatementRowCount: 18,
    sourceDocuments: [SOURCE_A, SOURCE_B],
  });
  assert.equal(result.status, "ok");
});

test("acceptance: structured blocker shape matches spec", () => {
  // Blocker payload must have status / reason / missingFacts / sourceDocuments
  // / userMessage exactly. UI consumers depend on this shape.
  const result = checkSpreadPreflight(
    baseInput({ sourceDocuments: [SOURCE_A] }),
  );
  if (result.status !== "blocked") {
    assert.fail("expected blocked");
  }
  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, [
    "missingFacts",
    "reason",
    "sourceDocuments",
    "status",
    "userMessage",
  ]);
});
