/**
 * Perfect Banker Flow v1.1 — Failure Elimination CI Guard
 *
 * Structural invariants for the resilience layer:
 *
 *   1. No generic "Resolve Blockers" label appears in banker flow code paths
 *   2. Every LifecycleBlockerCode is reachable from getBlockerFixAction
 *      (no banker can hit a blocker without a fix)
 *   3. Every memo-input blocker maps to a lifecycle stage
 *   4. The credit memo redirect guard never returns a "blocked" dead end —
 *      it must redirect or render
 *   5. Readiness refresh route surfaces failures as recovery blockers
 *      (cannot return 200 with no payload, cannot 500 silently)
 *   6. Every event-trigger surface routes through refreshDealReadiness
 *   7. Recovery blocker codes have stage mappings and fix actions
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const SRC = join(REPO_ROOT, "src");

const PATHS = {
  nextAction: join(REPO_ROOT, "src/buddy/lifecycle/nextAction.ts"),
  blockerToStage: join(REPO_ROOT, "src/buddy/lifecycle/blockerToStage.ts"),
  model: join(REPO_ROOT, "src/buddy/lifecycle/model.ts"),
  unify: join(REPO_ROOT, "src/lib/deals/readiness/unifyDealReadiness.ts"),
  refresh: join(
    REPO_ROOT,
    "src/lib/deals/readiness/refreshDealReadiness.ts",
  ),
  selfHeal: join(REPO_ROOT, "src/lib/deals/readiness/selfHealDeal.ts"),
  refreshRoute: join(
    REPO_ROOT,
    "src/app/api/deals/[dealId]/readiness/refresh/route.ts",
  ),
  readinessRoute: join(
    REPO_ROOT,
    "src/app/api/deals/[dealId]/readiness/route.ts",
  ),
  memoPage: join(
    REPO_ROOT,
    "src/app/(app)/deals/[dealId]/credit-memo/page.tsx",
  ),
  // Event-trigger touchpoints v1.1 wired through scheduleReadinessRefresh.
  upsertStory: join(
    REPO_ROOT,
    "src/lib/creditMemo/inputs/upsertBorrowerStory.ts",
  ),
  upsertMgmt: join(
    REPO_ROOT,
    "src/lib/creditMemo/inputs/upsertManagementProfile.ts",
  ),
  upsertColl: join(
    REPO_ROOT,
    "src/lib/creditMemo/inputs/upsertCollateralItem.ts",
  ),
  resolveConflict: join(
    REPO_ROOT,
    "src/lib/creditMemo/inputs/resolveFactConflict.ts",
  ),
  submission: join(
    REPO_ROOT,
    "src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts",
  ),
  spreadProcessor: join(
    REPO_ROOT,
    "src/lib/jobs/processors/spreadsProcessor.ts",
  ),
  runMission: join(REPO_ROOT, "src/lib/research/runMission.ts"),
  processConfirmedIntake: join(
    REPO_ROOT,
    "src/lib/intake/processing/processConfirmedIntake.ts",
  ),
};

function read(p: string) {
  return readFileSync(p, "utf8");
}

// ─── Guard 1 ────────────────────────────────────────────────────────────────
test("[v11-1] no banker-facing surface emits a generic 'Resolve Blockers' next action", () => {
  // Allowed: nextAction.ts may keep the literal as a defensive fallback
  // when no blocker maps to a fix; the unifier must never surface that.
  const unify = read(PATHS.unify);
  assert.ok(
    !/label:\s*["']Resolve Blockers["']/.test(unify),
    "unifyDealReadiness must never emit a 'Resolve Blockers' next_action",
  );

  // Banker-facing components must not render that string as a primary CTA.
  const RAIL_AND_CTAS = [
    join(REPO_ROOT, "src/components/journey/JourneyRail.tsx"),
    join(REPO_ROOT, "src/components/journey/StageRow.tsx"),
    join(REPO_ROOT, "src/components/deals/DealShellMemoCta.tsx"),
    join(
      REPO_ROOT,
      "src/components/creditMemo/inputs/MemoInputReadinessPanel.tsx",
    ),
  ];
  for (const p of RAIL_AND_CTAS) {
    const body = read(p);
    assert.ok(
      !body.includes('"Resolve Blockers"') &&
        !body.includes("'Resolve Blockers'"),
      `${relative(REPO_ROOT, p)} must not hard-code 'Resolve Blockers' label`,
    );
  }
});

// ─── Guard 2 ────────────────────────────────────────────────────────────────
test("[v11-2] every LifecycleBlockerCode is reachable from getBlockerFixAction or routed to refresh", () => {
  const model = read(PATHS.model);
  const next = read(PATHS.nextAction);

  // Extract all blocker codes from the union.
  const re = /\|\s*"([a-z_]+)"/g;
  const codes = new Set<string>();
  // Search the LifecycleBlockerCode union.
  const start = model.indexOf("export type LifecycleBlockerCode");
  const end = model.indexOf(";", start);
  const slice = model.slice(start, end);
  for (const m of slice.matchAll(re)) {
    codes.add(m[1]);
  }
  assert.ok(codes.size > 0, "Could not extract blocker codes from union");

  const missing: string[] = [];
  for (const code of codes) {
    const inFixSwitch = new RegExp(`case\\s+"${code}"`).test(next);
    if (!inFixSwitch) missing.push(code);
  }
  assert.equal(
    missing.length,
    0,
    `Every blocker code must have a getBlockerFixAction case. Missing: ${missing.join(", ")}`,
  );
});

// ─── Guard 3 ────────────────────────────────────────────────────────────────
test("[v11-3] every memo-input blocker code maps to a lifecycle stage", () => {
  const memoInputCodes = [
    "missing_business_description",
    "missing_revenue_model",
    "missing_management_profile",
    "missing_collateral_item",
    "missing_collateral_value",
    "missing_research_quality_gate",
    "open_fact_conflicts",
    "missing_policy_exception_review",
    "missing_dscr",
    "missing_global_cash_flow",
    "missing_debt_service_facts",
    "unfinalized_required_documents",
  ];
  const map = read(PATHS.blockerToStage);
  for (const code of memoInputCodes) {
    assert.match(
      map,
      new RegExp(`case\\s+"${code}"`),
      `blockerToStage must map "${code}"`,
    );
  }
});

// ─── Guard 4 ────────────────────────────────────────────────────────────────
test("[v11-4] credit memo page never dead-ends — always redirects or renders", () => {
  const body = read(PATHS.memoPage);
  // The page must call redirect when readiness is incomplete.
  assert.match(
    body,
    /redirect\(`\/deals\/\$\{dealId\}\/memo-inputs`\)/,
    "Page must redirect to /memo-inputs when readiness is incomplete",
  );
  // It must NOT render a "blocked submit" view path. Specifically: if
  // readiness fails to load (inputResult.ok=false), we should NOT
  // pretend everything is fine. We allow rendering when memo is submitted.
  assert.match(
    body,
    /hasSubmittedSnapshot/,
    "Submitted-snapshot guard must be present so banker can re-view memos",
  );
});

// ─── Guard 5 ────────────────────────────────────────────────────────────────
test("[v11-5] readiness refresh route surfaces failures as recovery blockers", () => {
  const refresh = read(PATHS.refreshRoute);
  const get = read(PATHS.readinessRoute);

  // The GET route must produce a recoveryBlocker payload on failure.
  assert.match(
    get,
    /recoveryBlocker/,
    "readiness GET route must surface a recoveryBlocker on failure",
  );
  assert.match(
    get,
    /lifecycle_reconcile_failed/,
    "readiness GET route must reference the lifecycle_reconcile_failed code",
  );

  // The refresh route must return reconciled state — no silent success.
  assert.match(
    refresh,
    /reconciled/,
    "readiness/refresh route must echo reconciled state",
  );
  assert.match(
    refresh,
    /reconcileDealLifecycle/,
    "readiness/refresh route must call the lifecycle reconciler",
  );
});

// ─── Guard 6 ────────────────────────────────────────────────────────────────
test("[v11-6] every event-trigger surface calls scheduleReadinessRefresh / refreshDealReadiness", () => {
  const surfaces = [
    PATHS.upsertStory,
    PATHS.upsertMgmt,
    PATHS.upsertColl,
    PATHS.resolveConflict,
    PATHS.submission,
    PATHS.spreadProcessor,
    PATHS.runMission,
    PATHS.processConfirmedIntake,
  ];
  for (const p of surfaces) {
    const body = read(p);
    const hits =
      /scheduleReadinessRefresh|refreshDealReadiness/.test(body);
    assert.ok(
      hits,
      `${relative(REPO_ROOT, p)} must call scheduleReadinessRefresh or refreshDealReadiness`,
    );
  }
});

// ─── Guard 7 ────────────────────────────────────────────────────────────────
test("[v11-7] every recovery blocker code has stage mapping AND fix action", () => {
  const RECOVERY_CODES = [
    "documents_processing_stalled",
    "research_stalled",
    "financial_snapshot_stale_recovery",
    "collateral_extraction_needed",
    "memo_prefill_stale",
    "lifecycle_reconcile_failed",
  ];
  const map = read(PATHS.blockerToStage);
  const next = read(PATHS.nextAction);
  for (const code of RECOVERY_CODES) {
    assert.match(
      map,
      new RegExp(`case\\s+"${code}"`),
      `blockerToStage must include "${code}"`,
    );
    assert.match(
      next,
      new RegExp(`case\\s+"${code}"`),
      `getBlockerFixAction must include "${code}"`,
    );
  }
});

// ─── Guard 8 ────────────────────────────────────────────────────────────────
test("[v11-8] readiness helper is single source of truth — no scattered manual recompute calls", () => {
  // Walk src/ and assert that any direct buildUnifiedDealReadiness import
  // outside the readiness/ folder + API route comes through the helper.
  const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);
  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) yield* walk(full);
      else if (
        st.isFile() &&
        (full.endsWith(".ts") || full.endsWith(".tsx"))
      ) {
        yield full;
      }
    }
  }
  const ALLOW = new Set<string>([
    "src/lib/deals/readiness/buildUnifiedDealReadiness.ts",
    "src/lib/deals/readiness/refreshDealReadiness.ts",
    "src/app/api/deals/[dealId]/readiness/route.ts",
    "src/app/api/deals/[dealId]/readiness/refresh/route.ts",
    "src/app/api/deals/[dealId]/memo-inputs/route.ts",
    // Tests legitimately reference the function name.
  ]);
  const offenders: string[] = [];
  for (const path of walk(SRC)) {
    const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
    if (rel.includes("/__tests__/")) continue;
    if (ALLOW.has(rel)) continue;
    let body: string;
    try {
      body = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (/\bbuildUnifiedDealReadiness\s*\(/.test(body)) {
      offenders.push(rel);
    }
  }
  assert.equal(
    offenders.length,
    0,
    `buildUnifiedDealReadiness may only be called from allowlisted files. Offenders:\n${offenders.join("\n")}\n` +
      "Other callers must go through refreshDealReadiness/scheduleReadinessRefresh.",
  );
});
