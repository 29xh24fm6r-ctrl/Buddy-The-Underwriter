import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-GCF-SOURCE-OF-TRUTH-AUDIT-AND-CONSOLIDATION-1 — invariant 7 (scoped to
 * the consumer this PR consolidates): memo readiness must obtain GCF through the
 * canonical fact-key contract (resolveGcfFactValue / GCF_GLOBAL_CASH_FLOW), not
 * by reading the legacy GLOBAL_CASH_FLOW key directly.
 */

const root = process.cwd();
function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

test("memo readiness loads GCF via the canonical contract, not the legacy key", () => {
  const src = read("src/lib/creditMemo/inputs/buildMemoInputPackage.ts");
  assert.ok(
    /resolveGcfFactValue/.test(src),
    "readiness must resolve GCF through resolveGcfFactValue",
  );
  assert.ok(
    /globalCashFlow:\s*GCF_CANONICAL_FACT_KEY/.test(src),
    "readiness must key GCF on the canonical GCF_GLOBAL_CASH_FLOW",
  );
  assert.ok(
    !/globalCashFlow:\s*CANONICAL_FACTS\.GLOBAL_CASH_FLOW\.fact_key/.test(src),
    "readiness must no longer read ONLY the legacy GLOBAL_CASH_FLOW key",
  );
});

test("the canonical selector exposes the GCF accessor contract", () => {
  const src = read("src/lib/financialFacts/getCanonicalGlobalCashFlow.ts");
  assert.ok(
    /export async function getCanonicalGlobalCashFlow/.test(src),
    "must export the canonical async accessor",
  );
});

test("[null-safe] the selector's spread query keeps null-error_code rows", () => {
  // SPEC-GCF-SELECTOR-NULL-SAFE-FILTER-1: a bare not-equal on error_code drops
  // NULL rows in PostgREST — which is every healthy queued/generating/ready GCF
  // row. The selector must use the null-safe OR filter (same fix as PR #463).
  const src = read("src/lib/financialFacts/getCanonicalGlobalCashFlow.ts");
  assert.ok(
    src.includes('.or("error_code.is.null,error_code.neq.SUPERSEDED_BY_NEWER_VERSION")'),
    "selector must use the null-safe .or() supersession filter",
  );
  assert.ok(
    !/\.neq\(\s*["']error_code["']\s*,\s*["']SUPERSEDED_BY_NEWER_VERSION["']\s*\)/.test(src),
    "the null-hostile bare not-equal on error_code must be removed",
  );
});
