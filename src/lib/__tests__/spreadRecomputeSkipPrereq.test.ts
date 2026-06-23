import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-SPREAD-WORKER-NOT-CLAIMING-GCF-JOBS-1 + SPEC-FINANCIALS-BEFORE-GCF-SEQUENCING-1.
 *
 * Original symptom (claiming spec): banker clicks Compute Global Cash Flow, the UI
 * shows "Computing…", but no worker ever claims the job and the canonical GLOBAL
 * placeholder is later marked ORPHANED_BY_FAILED_ORCHESTRATION.
 *
 * Sequencing spec refinement: GCF is a DOWNSTREAM aggregate. Re-running the GCF
 * spread cannot produce its upstream prerequisite facts (business cash flow, ADS,
 * personal/PFS), so the recompute route must make the prerequisite decision FIRST
 * and refuse to enqueue/placeholder GCF when those are missing — that is exactly
 * what created the orphan rows. Enforcement for OTHER (document-derived) spreads
 * still defers to the processor via skipPrereqCheck.
 */

const root = process.cwd();
function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

const ROUTE = "src/app/api/deals/[dealId]/spreads/recompute/route.ts";
const ENQUEUE = "src/lib/financialSpreads/enqueueSpreadRecompute.ts";

test("recompute route makes the GCF prerequisite decision BEFORE enqueue/placeholder", () => {
  const src = read(ROUTE);
  // Gate GCF on canonical prerequisites.
  assert.ok(
    /getCanonicalGlobalCashFlow/.test(src),
    "route must check GCF prerequisites via the canonical selector",
  );
  assert.ok(
    /prerequisitesReady/.test(src),
    "route must branch on canonical.prerequisitesReady",
  );
  // The prereq decision must come before the enqueue call.
  const prereqIdx = src.indexOf("prerequisitesReady");
  const enqueueIdx = src.indexOf("enqueueSpreadRecompute({");
  assert.ok(prereqIdx !== -1 && enqueueIdx !== -1);
  assert.ok(
    prereqIdx < enqueueIdx,
    "GCF prerequisite decision must precede enqueueSpreadRecompute",
  );
});

test("recompute route does NOT pre-create placeholders before a job is confirmed", () => {
  const src = read(ROUTE);
  // The old orphan-prone pattern was an up-front "generating" placeholder upsert
  // for every requested type, ahead of any job decision. That must be gone —
  // placeholders are now created by enqueueSpreadRecompute AFTER the job exists.
  assert.ok(
    !/status:\s*"generating"/.test(src),
    "route must not pre-create 'generating' placeholders ahead of job confirmation",
  );
});

test("recompute route returns prerequisite diagnostics without placeholder when GCF is gated", () => {
  const src = read(ROUTE);
  assert.ok(
    /gcf_prerequisites_missing/.test(src),
    "route must return explicit gcf_prerequisites_missing diagnostics",
  );
  assert.ok(
    /enqueueableTypes/.test(src),
    "route must drop gated GCF from the enqueueable set",
  );
});

test("banker-initiated recompute still enqueues NON-GCF types with skipPrereqCheck", () => {
  const src = read(ROUTE);
  assert.ok(
    /enqueueSpreadRecompute\(\{[\s\S]*?skipPrereqCheck:\s*true[\s\S]*?\}\)/.test(src),
    "document-derived spreads still enqueue via the processor (skipPrereqCheck:true)",
  );
});

test("enqueueSpreadRecompute creates placeholders only AFTER a job is confirmed", () => {
  const src = read(ENQUEUE);
  const jobIdx = src.indexOf("Resolve target job");
  const placeholderIdx = src.indexOf("Upsert placeholders (only after job is confirmed)");
  assert.ok(jobIdx !== -1 && placeholderIdx !== -1, "both steps must be present");
  assert.ok(jobIdx < placeholderIdx, "job resolution must precede placeholder upsert");
});
