import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveUnderwritingStance,
  stanceLabel,
  isUnderwritingReady,
  type ChecklistItemInput,
  type StanceInputs,
} from "@/lib/underwrite/deriveUnderwritingStance";

// ========================================
// Helper to build test inputs
// ========================================

function makeItem(key: string, status: ChecklistItemInput["status"]): ChecklistItemInput {
  return { checklist_key: key, status };
}

function makeInputs(items: ChecklistItemInput[]): StanceInputs {
  return { checklistItems: items, hasFinancialSnapshot: false };
}

// ========================================
// Core Stance Derivation Tests
// ========================================

test("ready_for_underwriting when both liquidity and cash flow present", () => {
  const items = [
    makeItem("PFS_CURRENT", "received"),
    makeItem("FIN_STMT_PL_YTD", "received"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "ready_for_underwriting");
  assert.ok(result.headline.includes("ready"));
  assert.deepEqual(result.missingSignals, []);
});

test("ready_for_underwriting with balance sheet and tax returns", () => {
  const items = [
    makeItem("FIN_STMT_BS_YTD", "received"),
    makeItem("IRS_BUSINESS_3Y", "received"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "ready_for_underwriting");
});

test("blocked_on_cash_flow when only liquidity present", () => {
  const items = [
    makeItem("PFS_CURRENT", "received"),
    makeItem("FIN_STMT_PL_YTD", "missing"),
    makeItem("IRS_PERSONAL_3Y", "missing"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "blocked_on_cash_flow");
  assert.ok(result.headline.includes("blocked on cash flow"));
  assert.ok(result.explanation?.includes("P&L") || result.explanation?.includes("tax"));
  assert.ok(result.missingSignals.length > 0);
});

test("blocked_on_liquidity when only cash flow present", () => {
  const items = [
    makeItem("PFS_CURRENT", "missing"),
    makeItem("FIN_STMT_BS_YTD", "missing"),
    makeItem("FIN_STMT_PL_YTD", "received"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "blocked_on_liquidity");
  assert.ok(result.headline.includes("blocked on liquidity"));
  assert.ok(result.explanation?.includes("balance sheet") || result.explanation?.includes("personal financial"));
});

test("insufficient_information when neither present", () => {
  const items = [
    makeItem("PFS_CURRENT", "missing"),
    makeItem("FIN_STMT_BS_YTD", "missing"),
    makeItem("FIN_STMT_PL_YTD", "missing"),
    makeItem("IRS_PERSONAL_3Y", "missing"),
    makeItem("IRS_BUSINESS_3Y", "missing"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "insufficient_information");
  assert.ok(result.headline.includes("incomplete"));
  assert.ok(result.missingSignals.length > 0);
});

test("insufficient_information with empty checklist", () => {
  const result = deriveUnderwritingStance(makeInputs([]));

  assert.equal(result.stance, "insufficient_information");
});

// ========================================
// Status Handling Tests
// ========================================

test("received status counts as evidence", () => {
  const items = [
    makeItem("PFS_CURRENT", "received"),
    makeItem("IRS_PERSONAL_3Y", "received"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "ready_for_underwriting");
});

test("reviewed_accepted status counts as evidence", () => {
  const items = [
    makeItem("FIN_STMT_BS_YTD", "reviewed_accepted"),
    makeItem("FIN_STMT_PL_YTD", "reviewed_accepted"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "ready_for_underwriting");
});

test("satisfied status counts as evidence", () => {
  const items = [
    makeItem("PFS_CURRENT", "satisfied"),
    makeItem("IRS_BUSINESS_3Y", "satisfied"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "ready_for_underwriting");
});

test("pending status does NOT count as evidence", () => {
  const items = [
    makeItem("PFS_CURRENT", "pending"),
    makeItem("FIN_STMT_PL_YTD", "pending"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "insufficient_information");
});

test("missing status does NOT count as evidence", () => {
  const items = [
    makeItem("PFS_CURRENT", "missing"),
    makeItem("FIN_STMT_PL_YTD", "missing"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "insufficient_information");
});

test("needs_review status does NOT count as evidence", () => {
  const items = [
    makeItem("PFS_CURRENT", "needs_review"),
    makeItem("FIN_STMT_PL_YTD", "needs_review"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "insufficient_information");
});

test("waived status does NOT count as evidence", () => {
  const items = [
    makeItem("PFS_CURRENT", "waived"),
    makeItem("FIN_STMT_PL_YTD", "waived"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  assert.equal(result.stance, "insufficient_information");
});

// ========================================
// Key Coverage Tests
// ========================================

test("any liquidity key satisfies liquidity requirement", () => {
  // PFS_CURRENT
  const withPfs = deriveUnderwritingStance(
    makeInputs([makeItem("PFS_CURRENT", "received"), makeItem("FIN_STMT_PL_YTD", "received")])
  );
  assert.equal(withPfs.stance, "ready_for_underwriting");

  // FIN_STMT_BS_YTD
  const withBs = deriveUnderwritingStance(
    makeInputs([makeItem("FIN_STMT_BS_YTD", "received"), makeItem("FIN_STMT_PL_YTD", "received")])
  );
  assert.equal(withBs.stance, "ready_for_underwriting");
});

test("any cash flow key satisfies cash flow requirement", () => {
  // FIN_STMT_PL_YTD
  const withPl = deriveUnderwritingStance(
    makeInputs([makeItem("PFS_CURRENT", "received"), makeItem("FIN_STMT_PL_YTD", "received")])
  );
  assert.equal(withPl.stance, "ready_for_underwriting");

  // IRS_PERSONAL_3Y
  const withPersonalTax = deriveUnderwritingStance(
    makeInputs([makeItem("PFS_CURRENT", "received"), makeItem("IRS_PERSONAL_3Y", "received")])
  );
  assert.equal(withPersonalTax.stance, "ready_for_underwriting");

  // IRS_BUSINESS_3Y
  const withBusinessTax = deriveUnderwritingStance(
    makeInputs([makeItem("PFS_CURRENT", "received"), makeItem("IRS_BUSINESS_3Y", "received")])
  );
  assert.equal(withBusinessTax.stance, "ready_for_underwriting");
});

// ========================================
// Helper Function Tests
// ========================================

test("stanceLabel returns human-readable labels", () => {
  assert.equal(stanceLabel("ready_for_underwriting"), "Ready");
  assert.equal(stanceLabel("blocked_on_cash_flow"), "Blocked (Cash Flow)");
  assert.equal(stanceLabel("blocked_on_liquidity"), "Blocked (Liquidity)");
  assert.equal(stanceLabel("blocked_on_both"), "Blocked");
  assert.equal(stanceLabel("insufficient_information"), "Incomplete");
});

test("isUnderwritingReady returns true only for ready stance", () => {
  assert.equal(isUnderwritingReady("ready_for_underwriting"), true);
  assert.equal(isUnderwritingReady("blocked_on_cash_flow"), false);
  assert.equal(isUnderwritingReady("blocked_on_liquidity"), false);
  assert.equal(isUnderwritingReady("blocked_on_both"), false);
  assert.equal(isUnderwritingReady("insufficient_information"), false);
});

// ========================================
// Edge Cases
// ========================================

test("mixed statuses - only valid statuses count", () => {
  const items = [
    makeItem("PFS_CURRENT", "received"), // valid
    makeItem("FIN_STMT_BS_YTD", "pending"), // invalid
    makeItem("FIN_STMT_PL_YTD", "missing"), // invalid
    makeItem("IRS_PERSONAL_3Y", "satisfied"), // valid
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  // Has liquidity (PFS_CURRENT) and cash flow (IRS_PERSONAL_3Y)
  assert.equal(result.stance, "ready_for_underwriting");
});

test("unrelated checklist items are ignored", () => {
  const items = [
    makeItem("RENT_ROLL", "received"),
    makeItem("PROPERTY_T12", "received"),
    makeItem("BANK_STMT_3M", "received"),
  ];

  const result = deriveUnderwritingStance(makeInputs(items));

  // None of these satisfy liquidity or cash flow
  assert.equal(result.stance, "insufficient_information");
});

test("result always has required fields", () => {
  const result = deriveUnderwritingStance(makeInputs([]));

  assert.ok(typeof result.stance === "string");
  assert.ok(typeof result.headline === "string");
  assert.ok(Array.isArray(result.missingSignals));
  // explanation is optional but if present should be string
  if (result.explanation !== undefined) {
    assert.ok(typeof result.explanation === "string");
  }
});
