import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-SPREAD-WORKER-NOT-CLAIMING-GCF-JOBS-1 regression guard.
 *
 * Symptom: banker clicks Compute Global Cash Flow, the UI shows "Computing…",
 * but no worker ever claims the job and the canonical GLOBAL placeholder is
 * later marked ORPHANED_BY_FAILED_ORCHESTRATION.
 *
 * Root cause: the recompute route unconditionally creates "generating"
 * placeholders for every requested type, then called enqueueSpreadRecompute on
 * the DEFAULT (prereq-gated) path. When a type's prereqs aren't met at that
 * instant, the gate drops it — creating NO backing job — so the placeholder is
 * orphaned and the pipeline never runs. A banker-initiated Compute must always
 * produce a job for what it shows; enforcement is deferred to the processor.
 */

const root = process.cwd();
function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

const ROUTE = "src/app/api/deals/[dealId]/spreads/recompute/route.ts";
const ENQUEUE = "src/lib/financialSpreads/enqueueSpreadRecompute.ts";

test("recompute route creates placeholders for requested types", () => {
  const src = read(ROUTE);
  // It writes a "generating" placeholder up front — which is exactly why it MUST
  // guarantee a backing job (next test), or those placeholders orphan.
  assert.ok(
    /status:\s*"generating"/.test(src) && /from\("deal_spreads"\)/.test(src),
    "route should create generating placeholders for immediate UI feedback",
  );
});

test("banker-initiated recompute enqueues with skipPrereqCheck (always creates a job)", () => {
  const src = read(ROUTE);
  assert.ok(
    /enqueueSpreadRecompute\(\{[\s\S]*?skipPrereqCheck:\s*true[\s\S]*?\}\)/.test(src),
    "recompute route must pass skipPrereqCheck:true so a job is always enqueued for the placeholders it shows",
  );
});

test("skipPrereqCheck bypasses the prereq drop that creates orphan placeholders", () => {
  const src = read(ENQUEUE);
  // When skipPrereqCheck is set, all valid types are treated as ready (no drop).
  assert.ok(
    /if\s*\(args\.skipPrereqCheck\)\s*\{[\s\S]{0,120}readyTypes\s*=\s*\[\.\.\.validTypes\]/.test(src),
    "skipPrereqCheck must treat all valid types as ready (enforcement moves to the processor)",
  );
  // The default path is the one that drops not-ready types with no job/placeholder.
  assert.ok(
    /SPREAD_WAITING_ON_FACTS/.test(src) && /waitingOnFacts:\s*true/.test(src),
    "default path drops not-ready types (waitingOnFacts) — must not be used by banker Compute",
  );
});
