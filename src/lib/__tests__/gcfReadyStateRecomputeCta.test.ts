import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-GCF-READY-STATE-RECOMPUTE-CTA-1 regression guard.
 *
 * In the ready state the GCF page showed KPIs/table but the compute action
 * disappeared (it only lived in the missing/error banners), so the banker
 * couldn't intentionally recompute GCF after fixes/new docs. The ready state
 * must keep a recompute action; Refresh must remain a data reload only.
 */

const PAGE = "src/app/(app)/deals/[dealId]/spreads/global-cash-flow/page.tsx";

function read(): string {
  return fs.readFileSync(path.resolve(process.cwd(), PAGE), "utf8");
}

test("ready state exposes a Recompute Global Cash Flow action", () => {
  const src = read();
  assert.ok(
    /Recompute Global Cash Flow/.test(src),
    "ready state must offer a 'Recompute Global Cash Flow' action",
  );
  // The recompute CTA is gated on the ready view (complements the missing/error
  // banners' Compute button rather than duplicating it).
  assert.ok(
    /view === "ready" &&[\s\S]{0,800}Recompute Global Cash Flow/.test(src),
    "recompute CTA must be shown in the ready view",
  );
});

test("recompute calls compute() (enqueues a job); Refresh stays a data reload", () => {
  const src = read();
  // The ready-state recompute button triggers compute(), distinct from Refresh.
  assert.ok(
    /onClick=\{\(\)\s*=>\s*void compute\(\)\}[\s\S]{0,800}Recompute Global Cash Flow/.test(src),
    "recompute CTA must trigger compute()",
  );
  // compute() posts the recompute endpoint for GLOBAL_CASH_FLOW (existing handler).
  assert.ok(
    /\/api\/deals\/\$\{dealId\}\/spreads\/recompute/.test(src) &&
      /types:\s*\["GLOBAL_CASH_FLOW"\]/.test(src),
    "compute() must POST the recompute endpoint for GLOBAL_CASH_FLOW",
  );
  // Refresh remains load()-only.
  assert.ok(
    /onClick=\{\(\)\s*=>\s*void load\(\)\}[\s\S]{0,300}Refresh/.test(src),
    "Refresh button must remain a data reload (load())",
  );
});

test("recompute is disabled while a compute is already in flight", () => {
  const src = read();
  assert.ok(
    /disabled=\{recomputing \|\| isComputing\}[\s\S]{0,500}Recompute Global Cash Flow/.test(src),
    "recompute CTA must be disabled while recomputing/computing",
  );
});
