/**
 * SPEC-M4 FIX-CARDS-1 — detectFixCardIssues unit tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectFixCardIssues } from "../detectFixCardIssues";

function emptyInput() {
  return { qualityFlags: [], riskFlags: [], checklistGaps: [], reconciliationFailures: [] };
}

test("returns no issues for a clean deal", () => {
  const issues = detectFixCardIssues(emptyInput());
  assert.deepEqual(issues, []);
});

test("quality flag becomes a warning-severity issue, strips parameter suffix from issueType", () => {
  const issues = detectFixCardIssues({
    ...emptyInput(),
    qualityFlags: ["BALANCE_SHEET_IMBALANCE:equity=plugged:plugged=100:components=90:gap=10"],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].issueType, "quality_flag:BALANCE_SHEET_IMBALANCE");
  assert.equal(issues[0].severity, "warning");
  assert.match(issues[0].summary, /Balance Sheet Imbalance/);
});

test("low-severity risk flags are excluded", () => {
  // Audit fix: RiskSeverity (modelEngine/types.ts) is uppercase — this is
  // the real shape persisted to deal_model_snapshots.risk_flags.
  const issues = detectFixCardIssues({
    ...emptyInput(),
    riskFlags: [{ key: "DSCR", value: 1.3, threshold: 1.25, severity: "LOW" }],
  });
  assert.deepEqual(issues, []);
});

test("DSCR risk flag gets the add-back documentation resolving action", () => {
  const issues = detectFixCardIssues({
    ...emptyInput(),
    riskFlags: [{ key: "DSCR", value: 1.1, threshold: 1.25, severity: "HIGH" }],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].issueType, "risk_flag:DSCR");
  assert.equal(issues[0].severity, "critical");
  assert.match(issues[0].resolvingAction, /add-backs/);
});

test("non-DSCR risk flag gets the generic banker-review action", () => {
  const issues = detectFixCardIssues({
    ...emptyInput(),
    riskFlags: [{ key: "CURRENT_RATIO", value: 0.5, threshold: 1.0, severity: "MEDIUM" }],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.match(issues[0].resolvingAction, /Review this figure with your banker/);
});

test("risk flag severity comparison is case-insensitive (regression: real data is uppercase)", () => {
  const lower = detectFixCardIssues({
    ...emptyInput(),
    riskFlags: [{ key: "DSCR", value: 1.1, threshold: 1.25, severity: "high" }],
  });
  assert.equal(lower[0]?.severity, "critical");

  const upper = detectFixCardIssues({
    ...emptyInput(),
    riskFlags: [{ key: "DSCR", value: 1.1, threshold: 1.25, severity: "HIGH" }],
  });
  assert.equal(upper[0]?.severity, "critical");
});

test("checklist gap becomes an info-severity issue carrying the checklistKey", () => {
  const issues = detectFixCardIssues({
    ...emptyInput(),
    checklistGaps: [{ checklistKey: "tax_return_2024", label: "2024 Business Tax Return" }],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].issueType, "checklist_gap:tax_return_2024");
  assert.equal(issues[0].severity, "info");
  assert.equal(issues[0].checklistKey, "tax_return_2024");
});

test("HARD reconciliation failure is critical, SOFT is warning", () => {
  const issues = detectFixCardIssues({
    ...emptyInput(),
    reconciliationFailures: [
      { checkId: "OWNERSHIP_INTEGRITY", description: "Ownership sums to 85%", severity: "SOFT", notes: "" },
      { checkId: "K1_TO_ENTITY", description: "K-1 income doesn't reconcile", severity: "HARD", notes: "" },
    ],
  });
  assert.equal(issues.length, 2);
  const soft = issues.find((i) => i.issueType === "reconciliation:OWNERSHIP_INTEGRITY");
  const hard = issues.find((i) => i.issueType === "reconciliation:K1_TO_ENTITY");
  assert.equal(soft?.severity, "warning");
  assert.equal(hard?.severity, "critical");
});

test("combines all four sources in one pass", () => {
  const issues = detectFixCardIssues({
    qualityFlags: ["MISSING_REVENUE"],
    riskFlags: [{ key: "DSCR", value: 1.1, threshold: 1.25, severity: "HIGH" }],
    checklistGaps: [{ checklistKey: "bank_statements", label: "Bank Statements" }],
    reconciliationFailures: [
      { checkId: "OWNERSHIP_INTEGRITY", description: "desc", severity: "SOFT", notes: "" },
    ],
  });
  assert.equal(issues.length, 4);
});
