/**
 * Perfect Banker Flow v1 — CI Guard
 *
 * Structural invariants for the unified banker journey:
 *
 *   1. JourneyRail must include the memo_inputs_required stage
 *   2. DealShell credit-memo CTA must be readiness-aware
 *   3. Credit memo submit route must return input readiness blockers
 *   4. Credit memo page must redirect incomplete memo inputs to /memo-inputs
 *   5. evaluateMemoInputReadiness blocker codes must map to lifecycle stages
 *   6. UnifiedDealReadiness must be the consumer for next_action selection
 *   7. Pure modules must not import "server-only"
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");

const PATHS = {
  rail: join(REPO_ROOT, "src/components/journey/JourneyRail.tsx"),
  shell: join(REPO_ROOT, "src/app/(app)/deals/[dealId]/DealShell.tsx"),
  shellCta: join(REPO_ROOT, "src/components/deals/DealShellMemoCta.tsx"),
  submitRoute: join(
    REPO_ROOT,
    "src/app/api/deals/[dealId]/credit-memo/submit/route.ts",
  ),
  creditMemoPage: join(
    REPO_ROOT,
    "src/app/(app)/deals/[dealId]/credit-memo/page.tsx",
  ),
  blockerToStage: join(REPO_ROOT, "src/buddy/lifecycle/blockerToStage.ts"),
  evaluator: join(
    REPO_ROOT,
    "src/lib/creditMemo/inputs/evaluateMemoInputReadiness.ts",
  ),
  unify: join(REPO_ROOT, "src/lib/deals/readiness/unifyDealReadiness.ts"),
  unifyTypes: join(REPO_ROOT, "src/lib/deals/readiness/types.ts"),
  reconciler: join(
    REPO_ROOT,
    "src/lib/deals/readiness/reconcileDealLifecycle.ts",
  ),
  prefill: join(REPO_ROOT, "src/lib/creditMemo/inputs/prefillMemoInputs.ts"),
  prefillTypes: join(REPO_ROOT, "src/lib/creditMemo/inputs/prefillTypes.ts"),
};

function read(p: string) {
  return readFileSync(p, "utf8");
}

// ─── Guard 1 ────────────────────────────────────────────────────────────────
test("[banker-flow-1] JourneyRail includes memo_inputs_required stage", () => {
  const body = read(PATHS.rail);
  assert.match(
    body,
    /CANONICAL_STAGES[\s\S]*?"memo_inputs_required"/,
    "JourneyRail.tsx must include memo_inputs_required in CANONICAL_STAGES",
  );
});

// ─── Guard 2 ────────────────────────────────────────────────────────────────
test("[banker-flow-2] DealShell credit-memo CTA is readiness-aware", () => {
  const shellBody = read(PATHS.shell);
  const ctaBody = read(PATHS.shellCta);
  assert.ok(
    shellBody.includes("DealShellMemoCta"),
    "DealShell must mount the DealShellMemoCta component",
  );
  for (const label of ["Complete Memo Inputs", "Review Credit Memo", "View Submitted Memo"]) {
    assert.ok(
      ctaBody.includes(label),
      `DealShellMemoCta must surface the "${label}" label`,
    );
  }
});

// ─── Guard 3 ────────────────────────────────────────────────────────────────
test("[banker-flow-3] credit-memo submit route returns input readiness blockers", () => {
  const body = read(PATHS.submitRoute);
  assert.match(
    body,
    /input_readiness_failed/,
    "Submit route must surface input_readiness_failed reason",
  );
  assert.match(
    body,
    /inputReadiness/,
    "Submit route response must include inputReadiness field",
  );
  assert.match(
    body,
    /input_readiness_failed[\s\S]*?409|409[\s\S]*?input_readiness_failed/,
    "Submit route must map input_readiness_failed to HTTP 409",
  );
});

// ─── Guard 4 ────────────────────────────────────────────────────────────────
test("[banker-flow-4] credit-memo page redirects incomplete memo inputs to /memo-inputs", () => {
  const body = read(PATHS.creditMemoPage);
  assert.match(
    body,
    /readiness\.ready[\s\S]*?redirect\(`\/deals\/\$\{dealId\}\/memo-inputs`\)/,
    "Page must redirect to /memo-inputs when readiness.ready is false",
  );
});

// ─── Guard 5 ────────────────────────────────────────────────────────────────
test("[banker-flow-5] evaluateMemoInputReadiness blocker codes map to lifecycle stages", () => {
  const evaluator = read(PATHS.evaluator);
  const map = read(PATHS.blockerToStage);

  const REQUIRED_TO_STAGE: Array<{ code: string; expectedStage: string }> = [
    { code: "missing_business_description", expectedStage: "memo_inputs_required" },
    { code: "missing_revenue_model", expectedStage: "memo_inputs_required" },
    { code: "missing_management_profile", expectedStage: "memo_inputs_required" },
    { code: "missing_collateral_item", expectedStage: "memo_inputs_required" },
    { code: "missing_collateral_value", expectedStage: "memo_inputs_required" },
    { code: "missing_research_quality_gate", expectedStage: "memo_inputs_required" },
    { code: "open_fact_conflicts", expectedStage: "memo_inputs_required" },
    { code: "missing_policy_exception_review", expectedStage: "memo_inputs_required" },
    { code: "missing_dscr", expectedStage: "underwrite_ready" },
    { code: "missing_global_cash_flow", expectedStage: "underwrite_ready" },
    { code: "missing_debt_service_facts", expectedStage: "underwrite_ready" },
  ];

  for (const { code, expectedStage } of REQUIRED_TO_STAGE) {
    assert.ok(
      evaluator.includes(`"${code}"`),
      `Evaluator must produce blocker code "${code}"`,
    );
    const re = new RegExp(
      `case\\s+"${code}"[\\s\\S]*?return\\s+"${expectedStage}"`,
    );
    assert.match(
      map,
      re,
      `blockerToStage must route "${code}" to "${expectedStage}"`,
    );
  }
});

// ─── Guard 6 ────────────────────────────────────────────────────────────────
test("[banker-flow-6] unified readiness picks topBlocker.fixLabel/fixPath as next_action", () => {
  const body = read(PATHS.unify);
  assert.match(
    body,
    /pickTopBlocker\s*\(/,
    "unifyDealReadiness must select a top blocker (no generic 'Resolve Blockers')",
  );
  assert.match(
    body,
    /label:\s*top\.fixLabel/,
    "next_action.label must come from top blocker's fixLabel",
  );
  assert.match(
    body,
    /href:\s*top\.fixPath/,
    "next_action.href must come from top blocker's fixPath",
  );
});

// ─── Guard 7 ────────────────────────────────────────────────────────────────
test("[banker-flow-7] pure modules must not import 'server-only'", () => {
  const importRe = /^\s*import\s+["']server-only["']/m;
  for (const p of [PATHS.unify, PATHS.unifyTypes, PATHS.prefillTypes]) {
    const body = read(p);
    assert.ok(
      !importRe.test(body),
      `${p} must remain pure — found 'server-only' import`,
    );
  }
});

// ─── Guard 8 ────────────────────────────────────────────────────────────────
test("[banker-flow-8] readiness GET route returns UnifiedDealReadiness alongside legacy fields", () => {
  const body = read(
    join(REPO_ROOT, "src/app/api/deals/[dealId]/readiness/route.ts"),
  );
  assert.match(body, /buildUnifiedDealReadiness/);
  assert.match(body, /readiness:\s*unified\.readiness/);
});

// ─── Guard 9 ────────────────────────────────────────────────────────────────
test("[banker-flow-9] reconciler is exposed and called by /readiness/refresh route", () => {
  const refreshBody = read(
    join(
      REPO_ROOT,
      "src/app/api/deals/[dealId]/readiness/refresh/route.ts",
    ),
  );
  assert.match(refreshBody, /reconcileDealLifecycle/);
  assert.match(refreshBody, /buildUnifiedDealReadiness/);
});
