import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getBlockerFixAction } from "@/buddy/lifecycle/nextAction";
import { evaluateMemoInputReadiness } from "@/lib/creditMemo/inputs/evaluateMemoInputReadiness";
import {
  resolveCanonicalGcf,
  type GcfSpreadRow,
  type GcfFactRow,
} from "@/lib/financialFacts/canonicalGcfCore";

/**
 * SPEC-GCF-SYSTEM-WIDE-PERMANENT-FIX-1 regression guard.
 *
 * One canonical GCF contract feeds blockers, the GCF page, and memo readiness.
 * Every GCF/DSCR blocker must route to an actionable compute screen; the GCF
 * page must derive its state from the canonical selector and never show an
 * in-flight compute as "missing".
 */

const root = process.cwd();
const DEAL_ID = "deal-xyz";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

const GCF_PAGE = "src/app/(app)/deals/[dealId]/spreads/global-cash-flow/page.tsx";
// SPEC-GCF-SYSTEM-WIDE-PERMANENT-FIX-1: the canonical GCF read is folded into the
// existing /spreads GET (canonical=gcf mode) — no new route.
const SPREADS_API = "src/app/api/deals/[dealId]/spreads/route.ts";

// ── 1. Fix paths are actionable ────────────────────────────────────────────

test("missing_global_cash_flow fixPath resolves to the GCF compute page", () => {
  const action = getBlockerFixAction(
    { code: "missing_global_cash_flow" } as any,
    DEAL_ID,
  );
  assert.ok(action);
  assert.equal((action as any).href, `/deals/${DEAL_ID}/spreads/global-cash-flow`);
});

test("missing_dscr fixPath is NOT the generic /spreads page", () => {
  const action = getBlockerFixAction({ code: "missing_dscr" } as any, DEAL_ID);
  assert.ok(action);
  assert.equal((action as any).href, `/deals/${DEAL_ID}/spreads/global-cash-flow`);
  assert.notEqual((action as any).href, `/deals/${DEAL_ID}/spreads`);
});

test("memo readiness emits the actionable GCF fixPaths for missing DSCR/GCF", () => {
  const r = evaluateMemoInputReadiness({
    dealId: DEAL_ID,
    borrowerStory: null,
    management: [],
    collateral: [],
    financialFacts: {
      dscr: null,
      annualDebtService: 200_000,
      globalCashFlow: null,
      loanAmount: 1_000_000,
    },
    research: { gate_passed: true, trust_grade: "committee_grade", quality_score: 0.9 },
    conflicts: [],
  });
  const dscr = r.blockers.find((b) => b.code === "missing_dscr");
  const gcf = r.blockers.find((b) => b.code === "missing_global_cash_flow");
  assert.ok(dscr, "missing_dscr blocker emitted");
  assert.ok(gcf, "missing_global_cash_flow blocker emitted");
  assert.equal(dscr!.fixPath, `/deals/${DEAL_ID}/spreads/global-cash-flow`);
  assert.notEqual(dscr!.fixPath, `/deals/${DEAL_ID}/spreads`);
  assert.equal(gcf!.fixPath, `/deals/${DEAL_ID}/spreads/global-cash-flow`);
});

// ── 2. Canonical selector: in-flight is never "missing" ────────────────────

test("a queued GCF spread row resolves to state 'queued', never 'missing'", () => {
  const spreadRows: GcfSpreadRow[] = [
    { status: "queued", owner_type: "GLOBAL", updated_at: "2026-06-23T00:00:00Z" },
  ];
  const r = resolveCanonicalGcf({ spreadRows, factRows: [] });
  assert.equal(r.state, "queued");
  assert.notEqual(r.state, "missing");
});

test("a generating GCF spread row resolves to state 'generating', never 'missing'", () => {
  const spreadRows: GcfSpreadRow[] = [
    { status: "generating", owner_type: "GLOBAL", updated_at: "2026-06-23T00:00:00Z" },
  ];
  const r = resolveCanonicalGcf({ spreadRows, factRows: [] });
  assert.equal(r.state, "generating");
});

test("an error GCF spread row surfaces precise upstream diagnostics", () => {
  const spreadRows: GcfSpreadRow[] = [
    {
      status: "error",
      owner_type: "GLOBAL",
      updated_at: "2026-06-23T00:00:00Z",
      error: "prereqs not met",
      error_code: "GCF_PREREQ_MISSING",
    },
  ];
  const r = resolveCanonicalGcf({ spreadRows, factRows: [] });
  assert.equal(r.state, "error");
  assert.ok(r.diagnostics.length > 0, "error state must carry diagnostics");
  // Diagnostics are specific upstream facts, not a generic "upload docs".
  assert.ok(
    r.diagnostics.some((d) => /cash flow|debt service|personal|PFS/i.test(d)),
    "diagnostics name the specific missing upstream facts",
  );
});

test("a materialized canonical fact resolves to state 'current' with value + DSCR", () => {
  const factRows: GcfFactRow[] = [
    { fact_key: "GCF_GLOBAL_CASH_FLOW", fact_value_num: 350_000, owner_type: "DEAL" },
    { fact_key: "GCF_DSCR", fact_value_num: 1.4, owner_type: "DEAL" },
  ];
  const r = resolveCanonicalGcf({ spreadRows: [], factRows });
  assert.equal(r.state, "current");
  assert.equal(r.value, 350_000);
  assert.equal(r.gcfDscr, 1.4);
});

// ── 3. GCF page wiring ─────────────────────────────────────────────────────

test("GCF page derives its state from the canonical selector contract", () => {
  const src = read(GCF_PAGE);
  assert.ok(
    /\/api\/deals\/\$\{dealId\}\/spreads\?canonical=gcf/.test(src),
    "page must read the canonical GCF endpoint (canonical=gcf mode)",
  );
  assert.ok(
    /CanonicalGcfResult/.test(src) && /canonical\?\.state/.test(src),
    "page view must be derived from canonical.state",
  );
});

test("GCF page renders Compute / Retry / Recompute actions", () => {
  const src = read(GCF_PAGE);
  assert.ok(/Compute Global Cash Flow/.test(src), "missing → Compute");
  assert.ok(/Retry Compute/.test(src), "error → Retry");
  assert.ok(/Recompute Global Cash Flow/.test(src), "ready → Recompute");
  assert.ok(
    /types:\s*\["GLOBAL_CASH_FLOW"\]/.test(src),
    "compute targets the GLOBAL_CASH_FLOW recompute",
  );
});

test("GCF page shows a 'Computing…' state and never reads in-flight as missing", () => {
  const src = read(GCF_PAGE);
  assert.ok(/Computing Global Cash Flow/.test(src), "computing banner present");
  // The computing branch is evaluated BEFORE the missing branch in the view
  // ternary, and isComputing keys off the canonical queued/generating state.
  assert.ok(
    /isComputing\s*\n?\s*\?\s*"computing"/.test(src) ||
      /isComputing[\s\S]{0,40}"computing"/.test(src),
    "computing must take precedence over missing in the view derivation",
  );
  assert.ok(
    /state === "queued" \|\| canonical\?\.state === "generating"/.test(src),
    "isComputing must include the canonical queued/generating states",
  );
});

test("GCF page renders canonical diagnostics in missing + error states", () => {
  const src = read(GCF_PAGE);
  assert.ok(/diagnostics/.test(src), "page reads canonical diagnostics");
  assert.ok(/Missing prerequisites/.test(src), "missing state lists prerequisites");
});

// ── 4. Canonical read endpoint exists and uses the selector ────────────────

test("spreads GET exposes a canonical=gcf mode backed by getCanonicalGlobalCashFlow", () => {
  const src = read(SPREADS_API);
  assert.ok(
    /getCanonicalGlobalCashFlow/.test(src),
    "endpoint must read the canonical selector",
  );
  assert.ok(
    /canonical"\) === "gcf"/.test(src),
    "must branch on the canonical=gcf query mode",
  );
  // Canonical mode must run BEFORE the pricing gate so diagnostics show even
  // when pricing is absent.
  const canonicalIdx = src.indexOf('canonical") === "gcf"');
  const pricingIdx = src.indexOf("PRICING GATE");
  assert.ok(canonicalIdx !== -1 && pricingIdx !== -1);
  assert.ok(
    canonicalIdx < pricingIdx,
    "canonical mode must return before the pricing gate",
  );
});
