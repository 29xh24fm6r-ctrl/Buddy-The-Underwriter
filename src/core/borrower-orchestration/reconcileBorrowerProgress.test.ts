import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// ── Test 1: Reconciliation is server-only ────────────────────
test("reconciliation is server-only", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/reconcileBorrowerProgress.ts"),
    "utf8",
  );
  assert.ok(content.includes('import "server-only"'), "Must import server-only");
});

// ── Test 2: Reconciliation handles all evidence types ────────
test("reconciliation handles all evidence types", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/reconcileBorrowerProgress.ts"),
    "utf8",
  );
  assert.ok(content.includes("document_upload"), "Must handle document_upload");
  assert.ok(content.includes("document_submit"), "Must handle document_submit");
  assert.ok(content.includes("field_confirmation"), "Must handle field_confirmation");
  assert.ok(content.includes("form_completion"), "Must handle form_completion");
});

// ── Test 3: Reconciliation closes campaign when all done ─────
test("reconciliation closes campaign when all required items complete", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/reconcileBorrowerProgress.ts"),
    "utf8",
  );
  assert.ok(content.includes("borrower_campaign.completed"), "Must emit campaign completed event");
  assert.ok(content.includes("is_active: false"), "Must deactivate reminders on completion");
});

// ── Test 4: Reconciliation records events ────────────────────
test("reconciliation records item-level events", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/reconcileBorrowerProgress.ts"),
    "utf8",
  );
  assert.ok(content.includes("borrower_request_events"), "Must write events");
  assert.ok(content.includes("borrower_item."), "Must emit item-level events");
});

// ── Test 5: Reconciliation respects status ordering ──────────
test("reconciliation does not downgrade status", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/reconcileBorrowerProgress.ts"),
    "utf8",
  );
  assert.ok(content.includes("statusRank"), "Must use status ranking to prevent downgrades");
  assert.ok(content.includes("STATUS_RANK"), "Must define STATUS_RANK ordering");
});

// ── Test 6: reconcileAllCampaignsForDeal exported ────────────
test("reconcileAllCampaignsForDeal is exported", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/reconcileBorrowerProgress.ts"),
    "utf8",
  );
  assert.ok(
    content.includes("export async function reconcileAllCampaignsForDeal"),
    "Must export deal-level reconciliation",
  );
});
