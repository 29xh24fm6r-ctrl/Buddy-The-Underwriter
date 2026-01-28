import test from "node:test";
import assert from "node:assert/strict";

import {
  isChecklistItemSatisfied,
  getSatisfiedRequired,
  getMissingRequired,
  type ChecklistItem,
} from "@/lib/deals/checklistSatisfaction";

// ── isChecklistItemSatisfied ─────────────────────────────────────────

test("isChecklistItemSatisfied: 'received' is satisfied", () => {
  assert.equal(isChecklistItemSatisfied({ status: "received" }), true);
});

test("isChecklistItemSatisfied: 'satisfied' is satisfied", () => {
  assert.equal(isChecklistItemSatisfied({ status: "satisfied" }), true);
});

test("isChecklistItemSatisfied: 'pending' is NOT satisfied", () => {
  assert.equal(isChecklistItemSatisfied({ status: "pending" }), false);
});

test("isChecklistItemSatisfied: null is NOT satisfied", () => {
  assert.equal(isChecklistItemSatisfied({ status: null }), false);
});

test("isChecklistItemSatisfied: 'missing' is NOT satisfied", () => {
  assert.equal(isChecklistItemSatisfied({ status: "missing" }), false);
});

// ── OCR → stamp → reconcile flow simulation ─────────────────────────
// This test proves the chain: document stamp sets status to "received",
// and the satisfaction helpers correctly detect it as complete.

test("OCR stamp → received status → checklist satisfied", () => {
  // Simulate a checklist before stamp
  const beforeStamp: ChecklistItem[] = [
    { checklist_key: "tax_returns_2023", status: "pending", required: true },
    { checklist_key: "bank_statements", status: "pending", required: true },
    { checklist_key: "personal_financial_statement", status: "pending", required: true },
    { checklist_key: "business_plan", status: "pending", required: false },
  ];

  // Before stamp: nothing satisfied
  assert.equal(getSatisfiedRequired(beforeStamp).length, 0);
  assert.equal(getMissingRequired(beforeStamp).length, 3);

  // Simulate stamp: DB trigger sets status to "received" for tax returns
  const afterFirstStamp: ChecklistItem[] = beforeStamp.map((item) =>
    item.checklist_key === "tax_returns_2023"
      ? { ...item, status: "received", received_at: new Date().toISOString() }
      : item
  );

  // After first stamp: 1 satisfied, 2 missing
  assert.equal(getSatisfiedRequired(afterFirstStamp).length, 1);
  assert.equal(getMissingRequired(afterFirstStamp).length, 2);

  // Stamp remaining required docs
  const afterAllStamps: ChecklistItem[] = afterFirstStamp.map((item) =>
    item.required
      ? { ...item, status: "received", received_at: new Date().toISOString() }
      : item
  );

  // After all stamps: 3 satisfied, 0 missing
  assert.equal(getSatisfiedRequired(afterAllStamps).length, 3);
  assert.equal(getMissingRequired(afterAllStamps).length, 0);

  // Optional item is NOT counted as "missing required"
  const optional = afterAllStamps.find((i) => i.checklist_key === "business_plan");
  assert.equal(optional?.status, "pending");
  assert.equal(getMissingRequired(afterAllStamps).length, 0);
});

test("mixed status values: only received and satisfied count", () => {
  const items: ChecklistItem[] = [
    { checklist_key: "a", status: "received", required: true },
    { checklist_key: "b", status: "satisfied", required: true },
    { checklist_key: "c", status: "pending", required: true },
    { checklist_key: "d", status: "rejected", required: true },
    { checklist_key: "e", status: null, required: true },
  ];

  assert.equal(getSatisfiedRequired(items).length, 2);
  assert.equal(getMissingRequired(items).length, 3);
});

test("empty checklist: no missing, no satisfied", () => {
  assert.equal(getSatisfiedRequired([]).length, 0);
  assert.equal(getMissingRequired([]).length, 0);
});
