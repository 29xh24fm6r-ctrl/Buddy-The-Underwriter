/**
 * Source-level guards for the banker analysis pipeline.
 *
 * Mirrors the pattern in src/lib/pulse/__tests__/forwardLedgerCore.test.ts —
 * fs-based assertions that catch drift in things you can't observe at runtime
 * (e.g. detached `.catch(() => {})` analysis promises sneaking back in).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const READ = (p: string) => fs.readFileSync(p, "utf-8");

const ORCH = "src/lib/underwriting/runBankerAnalysisPipeline.ts";
const ROUTE = "src/app/api/deals/[dealId]/banker-analysis/run/route.ts";
const SPREADS_PROC = "src/lib/jobs/processors/spreadsProcessor.ts";

// ── Orchestrator structure ─────────────────────────────────────────────────

test("orchestrator: exports runBankerAnalysisPipeline + recommendationFromGrade", () => {
  const src = READ(ORCH);
  assert.match(src, /export\s+async\s+function\s+runBankerAnalysisPipeline/);
  assert.match(src, /export\s+function\s+recommendationFromGrade/);
});

test("orchestrator: writes to all required tables", () => {
  const src = READ(ORCH);
  const required = [
    "deals",
    "deal_loan_requests",
    "deal_spreads",
    "risk_runs",
    "ai_risk_runs",
    "memo_runs",
    "memo_sections",
    "deal_decisions",
    "deal_credit_memo_status",
  ];
  for (const t of required) {
    assert.ok(
      new RegExp(`["']${t}["']`).test(src),
      `orchestrator must reference ${t}`,
    );
  }
});

test("orchestrator: every analysis step is awaited (no detached .catch on writes)", () => {
  const src = READ(ORCH);

  // The pipeline must not chain `.catch(() => {})` on its own analysis writes
  // — that would re-introduce fire-and-forget. Allowed: try/catch blocks.
  // Heuristic: count occurrences of `.catch(() => {})` on lines that are not
  // imports or type definitions. Anything > 0 is suspect.
  const offenders = src
    .split("\n")
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(line));
  assert.equal(
    offenders.length,
    0,
    `orchestrator must not use detached .catch(() => {}) — found at lines: ` +
      offenders.map((o) => o.i + 1).join(","),
  );
});

test("orchestrator: never uses void-discarded analysis promises", () => {
  const src = READ(ORCH);
  // Match `void someCall(...)` for our key writers.
  const dangerousPatterns = [
    /void\s+computeAuthoritativeEngine\s*\(/,
    /void\s+reconcileDeal\s*\(/,
    /void\s+writeLedger\s*\(/,
    /void\s+emitEvent\s*\(/,
    /void\s+(insertAiRiskRun|insertMemoRunRunning|insertMemoSections|insertSystemDecision|upsertCommitteeReadySignal)\s*\(/,
  ];
  for (const re of dangerousPatterns) {
    assert.ok(
      !re.test(src),
      `orchestrator must not void-discard analysis writes: ${re}`,
    );
  }
});

test("orchestrator: idempotency check uses risk_runs in-flight marker", () => {
  const src = READ(ORCH);
  assert.match(src, /isAnotherRunInFlight/);
  assert.match(src, /openRiskRunMarker/);
  assert.match(src, /IN_FLIGHT_DEDUP_WINDOW_MS/);
});

test("orchestrator: blockers cover required cases", () => {
  const src = READ(ORCH);
  for (const blocker of [
    "DEAL_NOT_FOUND",
    "TENANT_MISMATCH",
    "LOAN_REQUEST_INCOMPLETE",
    "SPREADS_NOT_READY",
    "MODEL_SNAPSHOT_FAILED",
    "RISK_RUN_FAILED",
    "MEMO_RUN_FAILED",
    "AI_RISK_RUN_WRITE_FAILED",
    "RISK_RUN_MARKER_UPDATE_FAILED",
    "MEMO_RUN_MARKER_UPDATE_FAILED",
    "MEMO_SECTION_WRITE_FAILED",
    "DECISION_WRITE_FAILED",
    "COMMITTEE_READY_WRITE_FAILED",
    "RECONCILIATION_CONFLICTS",
    "RECONCILIATION_FLAGS",
    "ALREADY_RUNNING",
  ]) {
    assert.ok(
      src.includes(blocker),
      `orchestrator must reference blocker code ${blocker}`,
    );
  }
});

test("orchestrator: invokes stale-run cleanup before opening a new run", () => {
  const src = READ(ORCH);
  assert.match(
    src,
    /cleanupStaleAnalysisRuns/,
    "orchestrator must wire cleanupStaleAnalysisRuns",
  );
});

// ── Route ───────────────────────────────────────────────────────────────────

test("route: awaits the pipeline and tunnels access.bankId", () => {
  const src = READ(ROUTE);
  assert.match(src, /await\s+runBankerAnalysisPipeline/);
  assert.match(src, /access\.bankId/);
  // Must NOT fire-and-forget
  assert.doesNotMatch(
    src,
    /void\s+runBankerAnalysisPipeline|runBankerAnalysisPipeline\([^)]*\)\.catch/,
    "route must not fire-and-forget the pipeline",
  );
});

test("route: validates tenant via ensureDealBankAccess", () => {
  const src = READ(ROUTE);
  assert.match(src, /ensureDealBankAccess/);
});

// ── Spreads worker hook ────────────────────────────────────────────────────

test("spreads worker: awaits banker analysis after SUCCEEDED", () => {
  const src = READ(SPREADS_PROC);
  // The hook must appear AFTER the SUCCEEDED status update
  const succeededIdx = src.indexOf('status: "SUCCEEDED"');
  const hookIdx = src.indexOf("runBankerAnalysisPipeline");
  assert.ok(succeededIdx > 0, "SUCCEEDED status update must exist");
  assert.ok(hookIdx > 0, "banker analysis hook must be wired");
  assert.ok(hookIdx > succeededIdx, "hook must run after SUCCEEDED");
});

test("spreads worker: hook is awaited (no .catch detached)", () => {
  const src = READ(SPREADS_PROC);
  // Find the hook block
  const hookStart = src.indexOf("runBankerAnalysisPipeline");
  assert.ok(hookStart > 0);
  const block = src.slice(hookStart, hookStart + 400);
  assert.match(
    block,
    /await\s+runBankerAnalysisPipeline/,
    "spreads worker must await runBankerAnalysisPipeline",
  );
});
