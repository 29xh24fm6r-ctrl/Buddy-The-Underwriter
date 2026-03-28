import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// ── Test 1: Borrower-safe action builds valid plan ───────────
test("request_documents builds valid borrower plan", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/mapCanonicalActionToBorrowerPlan.ts"),
    "utf8",
  );
  assert.ok(content.includes("request_documents"), "Must map request_documents");
  assert.ok(content.includes("Document Request"), "Must have campaign title");
  assert.ok(content.includes("requiresPortalLink: true"), "Must require portal link");
});

// ── Test 2: Non-borrower-safe action is not mapped ───────────
test("non-borrower-safe actions are not mapped", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/mapCanonicalActionToBorrowerPlan.ts"),
    "utf8",
  );
  // review_credit_memo should not appear in ACTION_TO_PLAN
  const planBlock = content.match(/const ACTION_TO_PLAN[\s\S]*?};/)?.[0] ?? "";
  assert.ok(!planBlock.includes("review_credit_memo"), "review_credit_memo must not be in plan map");
  assert.ok(!planBlock.includes("no_action_required"), "no_action_required must not be in plan map");
});

// ── Test 3: Catalog items have plain language ────────────────
test("catalog items contain no internal terminology", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/borrowerRequestCatalog.ts"),
    "utf8",
  );
  // Check descriptions
  const descriptions = content.match(/description:\s*"[^"]*"/g) ?? [];
  for (const desc of descriptions) {
    assert.ok(!desc.includes("DSCR"), `Description contains DSCR: ${desc}`);
    assert.ok(!desc.includes("LTV"), `Description contains LTV: ${desc}`);
    assert.ok(!desc.includes("blocker"), `Description contains blocker: ${desc}`);
    assert.ok(!desc.includes("canonical"), `Description contains canonical: ${desc}`);
  }
});

// ── Test 4: Plan builder is a pure function ──────────────────
test("plan builder has no server-only import", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/mapCanonicalActionToBorrowerPlan.ts"),
    "utf8",
  );
  assert.ok(!content.includes('import "server-only"'), "Plan builder must be pure (no server-only)");
  assert.ok(!content.includes("supabaseAdmin"), "Plan builder must not import supabase");
});

// ── Test 5: Catalog covers document types ────────────────────
test("catalog covers common document request types", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/borrowerRequestCatalog.ts"),
    "utf8",
  );
  const requiredItems = [
    "upload_tax_returns",
    "upload_financial_statements",
    "upload_pfs",
    "upload_general_documents",
    "complete_borrower_information",
  ];
  for (const item of requiredItems) {
    assert.ok(content.includes(item), `Missing catalog entry: ${item}`);
  }
});

// ── Test 6: BORROWER_ORCHESTRATABLE_ACTIONS is exported ──────
test("BORROWER_ORCHESTRATABLE_ACTIONS is exported", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/mapCanonicalActionToBorrowerPlan.ts"),
    "utf8",
  );
  assert.ok(
    content.includes("export const BORROWER_ORCHESTRATABLE_ACTIONS"),
    "Must export the set of orchestratable actions",
  );
});
