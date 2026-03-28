import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// ── Guard 1: Execute route exists ────────────────────────────
test("execute route exists", () => {
  const f = "src/app/api/deals/[dealId]/actions/execute/route.ts";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
});

// ── Guard 2: Route authenticates ─────────────────────────────
test("execute route authenticates", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/app/api/deals/[dealId]/actions/execute/route.ts"),
    "utf8",
  );
  assert.ok(
    content.includes("ensureDealBankAccess"),
    "Must authenticate via ensureDealBankAccess",
  );
});

// ── Guard 3: Route derives current canonical actions server-side ─
test("execute route derives current canonical actions server-side", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/app/api/deals/[dealId]/actions/execute/route.ts"),
    "utf8",
  );
  assert.ok(
    content.includes("deriveNextActions"),
    "Must derive current actions on server",
  );
  assert.ok(
    content.includes("getBuddyCanonicalState"),
    "Must fetch canonical state",
  );
});

// ── Guard 4: Route rejects invalid action code ───────────────
test("execute route rejects invalid action code", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/app/api/deals/[dealId]/actions/execute/route.ts"),
    "utf8",
  );
  assert.ok(
    content.includes("action_not_available"),
    "Must reject actions not in derived set",
  );
});

// ── Guard 5: Route calls executeCanonicalAction ──────────────
test("execute route calls executeCanonicalAction", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/app/api/deals/[dealId]/actions/execute/route.ts"),
    "utf8",
  );
  assert.ok(
    content.includes("executeCanonicalAction"),
    "Must call canonical executor",
  );
});

// ── Guard 6: Route returns refreshed state payload ───────────
test("execute route returns refreshed state payload", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/app/api/deals/[dealId]/actions/execute/route.ts"),
    "utf8",
  );
  assert.ok(content.includes("refreshed"), "Must return refreshed state");
  assert.ok(
    content.includes("refreshedActions.nextActions"),
    "Must include refreshed nextActions",
  );
  assert.ok(
    content.includes("refreshedActions.primaryAction"),
    "Must include refreshed primaryAction",
  );
});

// ── Guard 7: Migration exists ────────────────────────────────
test("canonical_action_executions migration exists", () => {
  const f = "supabase/migrations/20260328_canonical_action_executions.sql";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  const content = fs.readFileSync(path.resolve(root, f), "utf8");
  assert.ok(
    content.includes("canonical_action_executions"),
    "Must create canonical_action_executions table",
  );
});

// ── Guard 8: No Omega imports in execution layer ─────────────
test("no Omega imports in execution layer", () => {
  const files = [
    "src/core/actions/execution/executeCanonicalAction.ts",
    "src/core/actions/execution/types.ts",
    "src/core/actions/execution/canonicalActionExecutionMap.ts",
    "src/core/actions/execution/handlers/index.ts",
    "src/app/api/deals/[dealId]/actions/execute/route.ts",
  ];
  for (const f of files) {
    const content = fs.readFileSync(path.resolve(root, f), "utf8");
    assert.ok(
      !content.includes("@/core/omega"),
      `${f} must not import Omega`,
    );
  }
});

// ── Guard 9: Execution map is exhaustive ─────────────────────
test("execution map covers all BuddyActionCode values", () => {
  const typesContent = fs.readFileSync(
    path.resolve(root, "src/core/actions/types.ts"),
    "utf8",
  );
  const mapContent = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/canonicalActionExecutionMap.ts"),
    "utf8",
  );

  const actionCodeBlock =
    typesContent.match(/export type BuddyActionCode\s*=([\s\S]*?);/)?.[1] ?? "";
  const codeMatches = actionCodeBlock.match(/"\w+"/g) ?? [];
  const codes = codeMatches.map((m) => m.replace(/"/g, ""));

  for (const code of codes) {
    assert.ok(
      mapContent.includes(`${code}:`),
      `Execution map missing entry for code: ${code}`,
    );
  }
});

// ── Guard 10: Executor records canonical execution ───────────
test("executor records canonical execution", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/actions/execution/executeCanonicalAction.ts"),
    "utf8",
  );
  assert.ok(
    content.includes("canonical_action_executions"),
    "Must record canonical execution",
  );
  assert.ok(
    content.includes("logLedgerEvent"),
    "Must emit ledger event",
  );
});

// ── Guard 11: Execution types module exists ──────────────────
test("execution layer modules exist", () => {
  const files = [
    "src/core/actions/execution/types.ts",
    "src/core/actions/execution/executeCanonicalAction.ts",
    "src/core/actions/execution/canonicalActionExecutionMap.ts",
    "src/core/actions/execution/handlers/index.ts",
    "src/core/actions/execution/handlers/requestDocuments.ts",
    "src/core/actions/execution/handlers/seedChecklist.ts",
    "src/core/actions/execution/handlers/runExtraction.ts",
    "src/core/actions/execution/handlers/generateFinancialSnapshot.ts",
    "src/core/actions/execution/handlers/taskOnly.ts",
    "src/core/actions/execution/handlers/noActionRequired.ts",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 12: NextStep adapter exists ────────────────────────
test("mapPrimaryActionToNextStepCandidate exists", () => {
  const f = "src/lib/dealCommandCenter/mapPrimaryActionToNextStepCandidate.ts";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  const content = fs.readFileSync(path.resolve(root, f), "utf8");
  assert.ok(content.includes("mapPrimaryActionToNextStepCandidate"), "Must export adapter");
  assert.ok(content.includes("BuddyNextAction"), "Must use BuddyNextAction type");
});

// ── Guard 13: DealNextActionsPanel has execution affordance ──
test("DealNextActionsPanel has execution buttons", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/components/deal/DealNextActionsPanel.tsx"),
    "utf8",
  );
  assert.ok(content.includes("handleExecute"), "Must have execute handler");
  assert.ok(content.includes("/api/deals/"), "Must call execute API");
  assert.ok(content.includes("data-buddy-actions"), "Must preserve actions DOM marker");
  assert.ok(content.includes("data-primary-action"), "Must preserve primary action marker");
});
