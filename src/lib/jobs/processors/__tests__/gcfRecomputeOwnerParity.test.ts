import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { resolveOwnerType } from "@/lib/financialSpreads/resolveOwnerType";

/**
 * SPEC-GCF-RECOMPUTE-OWNER-TYPE-PARITY-1 regression guard.
 *
 * Compute Global Cash Flow created a GLOBAL-owned placeholder, but the GCF
 * "second render" (PR5g) in the spreads processor passed the UNRESOLVED job-meta
 * ownerType (default "DEAL") to renderSpread — and renderSpread persists
 * owner_type RAW. So the worker wrote a DEAL-owned ready row while the canonical
 * GLOBAL placeholder stayed queued/generating forever and the UI polled forever.
 *
 * Fix: every GCF placeholder, CAS claim, and render must use
 * resolveOwnerType("GLOBAL_CASH_FLOW", …) === "GLOBAL".
 */

const root = process.cwd();
function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

const PROCESSOR = "src/lib/jobs/processors/spreadsProcessor.ts";
const ENQUEUE = "src/lib/financialSpreads/enqueueSpreadRecompute.ts";
const ROUTE = "src/app/api/deals/[dealId]/spreads/recompute/route.ts";

test("GLOBAL_CASH_FLOW always resolves to the canonical GLOBAL owner_type", () => {
  for (const meta of [undefined, "DEAL", "GLOBAL", "PERSONAL", "anything"]) {
    assert.equal(
      resolveOwnerType("GLOBAL_CASH_FLOW", meta as any),
      "GLOBAL",
      `GCF owner must be GLOBAL regardless of job-meta ownerType=${meta}`,
    );
  }
});

test("placeholder, claim, and second render share one resolved owner contract", () => {
  // Placeholder (enqueue + route) resolves owner_type.
  assert.ok(
    /owner_type:\s*resolveOwnerType\(/.test(read(ENQUEUE)),
    "enqueue placeholder must resolve owner_type",
  );
  assert.ok(
    /owner_type:\s*resolveOwnerType\(/.test(read(ROUTE)),
    "recompute route placeholder must resolve owner_type",
  );

  // Processor: CAS claim + both renders resolve owner_type per spread type.
  const proc = read(PROCESSOR);
  assert.ok(
    /const effectiveOwnerType = resolveOwnerType\(spreadType, ownerType\)/.test(proc),
    "CAS claim must use resolveOwnerType(spreadType, ownerType)",
  );
});

test("the GCF second render no longer passes a raw, unresolved owner_type", () => {
  const proc = read(PROCESSOR);
  // The exact regression: ownerType: ownerType ?? "DEAL" handed to renderSpread.
  assert.ok(
    !/ownerType:\s*ownerType\s*\?\?\s*["']DEAL["']/.test(proc),
    "GCF render must not pass the unresolved job-meta ownerType (?? 'DEAL')",
  );
  // The second render resolves to the canonical owner instead. This literal
  // only appears at the GCF re-render site (the CAS claim uses the `spreadType`
  // variable, not the string literal).
  assert.ok(
    /resolveOwnerType\(\s*"GLOBAL_CASH_FLOW"\s+as SpreadType,\s*ownerType\s*\)/.test(proc),
    "the GCF second render must resolve owner_type via resolveOwnerType('GLOBAL_CASH_FLOW', ownerType)",
  );
});
