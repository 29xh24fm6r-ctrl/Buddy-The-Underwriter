/**
 * Memo Input Completeness CI Guard
 *
 * Structural invariants for the Memo Input Completeness Layer:
 *
 *   1. submitCreditMemoToUnderwriting MUST call evaluateMemoInputReadiness
 *   2. submitCreditMemoToUnderwriting MUST call buildMemoInputPackage
 *   3. The Florida Armory snapshot persistence MUST include either a direct
 *      memo_input_package field or a structurally-equivalent source-derived
 *      data_sources_json that carries the package.
 *   4. BankerReviewPanel.tsx MUST submit through the server gate — no
 *      direct credit_memo_snapshots writes from the client.
 *   5. The pure evaluator MUST NOT import "server-only" or any server-only
 *      module — CI guards rely on importing it at test time.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const SUBMIT_PATH = join(
  REPO_ROOT,
  "src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts",
);
const EVALUATOR_PATH = join(
  REPO_ROOT,
  "src/lib/creditMemo/inputs/evaluateMemoInputReadiness.ts",
);
const TYPES_PATH = join(
  REPO_ROOT,
  "src/lib/creditMemo/inputs/types.ts",
);
const DETECT_PATH = join(
  REPO_ROOT,
  "src/lib/creditMemo/inputs/detectFactConflicts.ts",
);
const PANEL_PATH = join(
  REPO_ROOT,
  "src/components/creditMemo/BankerReviewPanel.tsx",
);

function read(p: string): string {
  return readFileSync(p, "utf8");
}

// ─── Guard 1 ────────────────────────────────────────────────────────────────
test("[memo-input-1] submitCreditMemoToUnderwriting calls evaluateMemoInputReadiness", () => {
  const body = read(SUBMIT_PATH);
  assert.match(
    body,
    /evaluateMemoInputReadiness\s*\(/,
    "submitCreditMemoToUnderwriting must invoke evaluateMemoInputReadiness",
  );
});

// ─── Guard 2 ────────────────────────────────────────────────────────────────
test("[memo-input-2] submitCreditMemoToUnderwriting calls buildMemoInputPackage", () => {
  const body = read(SUBMIT_PATH);
  assert.match(
    body,
    /buildMemoInputPackage\s*\(/,
    "submitCreditMemoToUnderwriting must invoke buildMemoInputPackage",
  );
});

// ─── Guard 3 ────────────────────────────────────────────────────────────────
test("[memo-input-3] Florida Armory snapshot insert includes memo_input_package", () => {
  const body = read(SUBMIT_PATH);
  // The snapshot row's data_sources_json must carry the input package so
  // the underwriter can verify completeness from the frozen JSON alone.
  assert.match(
    body,
    /data_sources_json[\s\S]*?memo_input_package/,
    "data_sources_json must carry memo_input_package",
  );
  assert.match(
    body,
    /memo_input_readiness/,
    "snapshot must record the readiness contract that was satisfied at submission",
  );
});

// ─── Guard 4 ────────────────────────────────────────────────────────────────
test("[memo-input-4] BankerReviewPanel cannot bypass the server gate", () => {
  const body = read(PANEL_PATH);
  assert.ok(
    !/from\(['"]credit_memo_snapshots['"]\)/.test(body),
    "BankerReviewPanel must not write directly to credit_memo_snapshots",
  );
  assert.ok(
    body.includes("/credit-memo/submit"),
    "BankerReviewPanel must submit through the credit-memo/submit route",
  );
});

// ─── Guard 5 ────────────────────────────────────────────────────────────────
test("[memo-input-5] pure modules must not import 'server-only'", () => {
  // Match only actual import statements (start of line, allowing whitespace),
  // not the literal substring inside comments.
  const importRe = /^\s*import\s+["']server-only["']/m;
  for (const p of [EVALUATOR_PATH, TYPES_PATH, DETECT_PATH]) {
    const body = read(p);
    assert.ok(
      !importRe.test(body),
      `${p} must remain pure — found 'server-only' import statement`,
    );
    // Banned modules that transitively pull server-only.
    const importPathRe = (path: string) =>
      new RegExp(`^\\s*import[^"']*from\\s+["']${path}["']`, "m");
    for (const banned of [
      "@/lib/supabase/admin",
      "@/lib/ledger/writeEvent",
    ]) {
      assert.ok(
        !importPathRe(banned).test(body),
        `${p} imports banned server-only dependency ${banned}`,
      );
    }
  }
});

// ─── Guard 6 ────────────────────────────────────────────────────────────────
test("[memo-input-6] all 11 spec blocker codes are produced by the evaluator", () => {
  // The evaluator is the source of truth for blocker codes. The CI guard
  // ensures every spec-listed code is actually reachable in the evaluator —
  // an AI refactor that silently drops a blocker should fail here.
  const body = read(EVALUATOR_PATH);
  const REQUIRED_CODES = [
    "missing_business_description",
    "missing_revenue_model",
    "missing_management_profile",
    "missing_collateral_item",
    "missing_collateral_value",
    "missing_research_quality_gate",
    "open_fact_conflicts",
    "unfinalized_required_documents",
    "missing_dscr",
    "missing_global_cash_flow",
    "missing_policy_exception_review",
    "missing_debt_service_facts",
  ];
  for (const code of REQUIRED_CODES) {
    assert.ok(
      body.includes(`"${code}"`),
      `evaluateMemoInputReadiness must be capable of producing blocker "${code}"`,
    );
  }
});

// ─── Guard 7 ────────────────────────────────────────────────────────────────
test("[memo-input-7] submission API maps input_readiness_failed to 409", () => {
  const routePath = join(
    REPO_ROOT,
    "src/app/api/deals/[dealId]/credit-memo/submit/route.ts",
  );
  const body = read(routePath);
  assert.match(
    body,
    /input_readiness_failed[\s\S]*409|409[\s\S]*input_readiness_failed/,
    "credit-memo/submit route must map input_readiness_failed to HTTP 409",
  );
});
