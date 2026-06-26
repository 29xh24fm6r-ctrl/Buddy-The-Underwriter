import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getBlockerFixAction, getNextAction } from "@/buddy/lifecycle/nextAction";
import type { LifecycleState } from "@/buddy/lifecycle/model";

/**
 * SPEC-FINANCIAL-READINESS-GCF-PREREQ-REPAIR-1 — wiring + behavior guards.
 *
 * Asserts that prerequisite repair runs BEFORE the surfaces that decide or
 * persist GCF / financial-snapshot blockers (recompute/retry, snapshot
 * generate/recompute, memo readiness), that GCF retry stays orphan-recoverable
 * without weakening the prerequisite gate, and that the rail/cockpit point to the
 * earliest actual financial prerequisite.
 */

const root = process.cwd();
function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

const RECOMPUTE_ROUTE = "src/app/api/deals/[dealId]/spreads/recompute/route.ts";
const SNAPSHOT_GENERATE = "src/app/api/deals/[dealId]/snapshot/generate/route.ts";
const SNAPSHOT_RECOMPUTE = "src/app/api/deals/[dealId]/financial-snapshot/recompute/route.ts";
const MEMO_BUILD = "src/lib/creditMemo/inputs/buildMemoInputPackage.ts";
const ENQUEUE = "src/lib/financialSpreads/enqueueSpreadRecompute.ts";

// ── 6 + 9. GCF retry: repair first, gate preserved, orphan recoverable ──────

test("AC6: GCF recompute/retry runs prerequisite repair BEFORE the prerequisite gate", () => {
  const src = read(RECOMPUTE_ROUTE);
  const repairIdx = src.indexOf("ensureFinancialReadinessPrerequisites");
  const gateIdx = src.indexOf("getCanonicalGlobalCashFlow(dealId, access.bankId)");
  assert.ok(repairIdx !== -1, "route must run ensureFinancialReadinessPrerequisites");
  assert.ok(gateIdx !== -1, "route must still evaluate canonical GCF prerequisites");
  assert.ok(repairIdx < gateIdx, "repair must run before the prerequisite re-evaluation");
});

test("AC6b: GCF gate is NOT weakened — still refuses to enqueue when not ready", () => {
  const src = read(RECOMPUTE_ROUTE);
  assert.ok(/prerequisitesReady/.test(src), "still branches on prerequisitesReady");
  assert.ok(/gcf_prerequisites_missing/.test(src), "still returns gated diagnostics when not ready");
  // The repair must precede enqueue so a freshly-ready GCF can enqueue this pass.
  const repairIdx = src.indexOf("ensureFinancialReadinessPrerequisites");
  const enqueueIdx = src.indexOf("enqueueSpreadRecompute({");
  assert.ok(repairIdx < enqueueIdx, "repair precedes enqueue");
});

test("AC9: enqueue placeholder upsert clears the orphan error so a stale GLOBAL row is recoverable", () => {
  const src = read(ENQUEUE);
  // The placeholder upsert (conflict on the GLOBAL row's natural key) resets the
  // ORPHANED_BY_FAILED_ORCHESTRATION error + last_run_id so the orphan becomes
  // claimable again — no row deletion, existing safe upsert semantics.
  const block = src.slice(src.indexOf("Upsert placeholders"));
  assert.ok(/status:\s*"queued"/.test(block), "orphan row is reset to queued");
  assert.ok(/error_code:\s*null/.test(block), "error_code (incl. orphan) cleared");
  assert.ok(/error:\s*null/.test(block), "error cleared");
  assert.ok(/last_run_id:\s*null/.test(block), "last_run_id reset so a fresh run can claim it");
});

// ── 7 + 10. Snapshot + memo readiness reference repair before blockers ──────

test("AC7/AC10: financial snapshot generate runs repair before building the snapshot", () => {
  const src = read(SNAPSHOT_GENERATE);
  const repairIdx = src.indexOf("ensureFinancialReadinessPrerequisites");
  const buildIdx = src.indexOf("buildFinancialSnapshot({");
  assert.ok(repairIdx !== -1, "generate route references prerequisite repair");
  assert.ok(repairIdx < buildIdx, "repair runs before snapshot build");
});

test("AC7/AC10: financial snapshot recompute runs repair before the preflight blocker decision", () => {
  const src = read(SNAPSHOT_RECOMPUTE);
  const repairIdx = src.indexOf("ensureFinancialReadinessPrerequisites");
  const preflightIdx = src.indexOf("const preflightReasons");
  assert.ok(repairIdx !== -1, "recompute route references prerequisite repair");
  assert.ok(repairIdx < preflightIdx, "repair runs before preflight reasons are collected");
});

test("AC10: memo readiness build runs repair before loading canonical GCF prerequisites", () => {
  const src = read(MEMO_BUILD);
  const repairIdx = src.indexOf("ensureFinancialReadinessPrerequisites");
  const gcfLoadIdx = src.indexOf("getCanonicalGlobalCashFlow(args.dealId, bankId)");
  assert.ok(repairIdx !== -1, "memo build references prerequisite repair");
  assert.ok(gcfLoadIdx !== -1, "memo build still loads canonical GCF");
  assert.ok(repairIdx < gcfLoadIdx, "repair runs before GCF prerequisite state is read");
});

// ── 8. Rail / cockpit point to the earliest actual financial prerequisite ───

function stateWithBlockers(codes: string[]): LifecycleState {
  return {
    stage: "memo_inputs_required",
    blockers: codes.map((code) => ({ code, message: code, severity: "blocking" })),
  } as unknown as LifecycleState;
}

test("AC8: when annual debt service is the earliest financial gap, CTA routes to financial analysis, not snapshot", () => {
  // missing_business_cash_flow / missing_dscr both route to /financials, never the
  // snapshot action. The earliest-upstream blocker is blockers[0].
  const action = getBlockerFixAction({ code: "missing_dscr" } as any, "d1");
  assert.ok(action && "href" in action);
  assert.equal((action as any).href, "/deals/d1/financials");
  assert.notEqual((action as any).action, "financial_snapshot.recompute");
});

test("AC8b: rail next-action follows blocker ordering — earliest financial prerequisite wins over snapshot", () => {
  // Even if a financial_snapshot_missing blocker is present, an earlier
  // missing_business_cash_flow must drive the primary CTA.
  const next = getNextAction(
    stateWithBlockers(["missing_business_cash_flow", "financial_snapshot_missing"]),
    "d1",
  );
  assert.equal(next.href, "/deals/d1/financials");
  assert.notEqual(next.label, "Generate Snapshot");
});

test("AC8c: when prerequisites are ready but GCF missing, CTA points to GCF compute page", () => {
  const action = getBlockerFixAction({ code: "missing_global_cash_flow" } as any, "d1");
  assert.ok(action && "href" in action);
  assert.equal((action as any).href, "/deals/d1/spreads/global-cash-flow");
});

test("AC8d: financial snapshot action itself first repairs prerequisites (safe to be a CTA)", () => {
  // The snapshot CTA action (financial_snapshot.recompute) is allowed to be the
  // primary action only because its route runs prerequisite repair first.
  const action = getBlockerFixAction({ code: "financial_snapshot_missing" } as any, "d1");
  assert.ok(action && "action" in action);
  assert.equal((action as any).action, "financial_snapshot.recompute");
  const routeSrc = read(SNAPSHOT_RECOMPUTE);
  assert.ok(
    /ensureFinancialReadinessPrerequisites/.test(routeSrc),
    "the financial_snapshot.recompute route must repair prerequisites first",
  );
});
