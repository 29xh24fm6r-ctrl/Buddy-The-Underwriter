import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveCanonicalGcf,
  resolveGcfFactValue,
  GCF_CANONICAL_FACT_KEY,
  GCF_LEGACY_FACT_KEY,
  type GcfFactRow,
  type GcfSpreadRow,
} from "@/lib/financialFacts/canonicalGcfCore";

/**
 * SPEC-GCF-SOURCE-OF-TRUTH-AUDIT-AND-CONSOLIDATION-1 — invariants 1–5.
 * The pure selector is the single contract; memo readiness reads GCF via the
 * same resolveGcfFactValue, so these tests cover both.
 */

function fact(over: Partial<GcfFactRow>): GcfFactRow {
  return {
    fact_key: GCF_CANONICAL_FACT_KEY,
    fact_value_num: 0,
    owner_type: "DEAL",
    fact_period_end: "2025-12-31",
    created_at: "2026-01-01",
    is_superseded: false,
    ...over,
  };
}

test("[inv-1] readiness clears when GCF_GLOBAL_CASH_FLOW exists", () => {
  const rows = [fact({ fact_key: GCF_CANONICAL_FACT_KEY, fact_value_num: 350_000 })];
  const r = resolveGcfFactValue(rows);
  assert.equal(r.value, 350_000); // non-null → readiness blocker clears
  assert.equal(r.factKey, GCF_CANONICAL_FACT_KEY);
  assert.equal(r.usedLegacy, false);
  assert.equal(resolveCanonicalGcf({ spreadRows: [], factRows: rows }).state, "current");
});

test("[inv-2] legacy GLOBAL_CASH_FLOW alias is used as fallback with a warning", () => {
  const rows = [fact({ fact_key: GCF_LEGACY_FACT_KEY, fact_value_num: 290_000 })];
  const r = resolveGcfFactValue(rows);
  assert.equal(r.value, 290_000); // readiness still clears via fallback
  assert.equal(r.usedLegacy, true);
  const sel = resolveCanonicalGcf({ spreadRows: [], factRows: rows });
  assert.equal(sel.state, "legacy_fallback");
  assert.equal(sel.source, "legacy_fact");
  assert.ok(sel.warnings.some((w) => /legacy GLOBAL_CASH_FLOW/.test(w)));
});

test("[inv-2b] canonical key wins over legacy when both exist", () => {
  const rows = [
    fact({ fact_key: GCF_CANONICAL_FACT_KEY, fact_value_num: 350_000 }),
    fact({ fact_key: GCF_LEGACY_FACT_KEY, fact_value_num: 999_999 }),
  ];
  assert.equal(resolveGcfFactValue(rows).value, 350_000);
  assert.equal(resolveGcfFactValue(rows).factKey, GCF_CANONICAL_FACT_KEY);
});

test("[inv-3] selector value agrees with the canonical fact (one number everywhere)", () => {
  const rows = [
    fact({ fact_key: GCF_CANONICAL_FACT_KEY, fact_value_num: 412_000 }),
    fact({ fact_key: "GCF_DSCR", fact_value_num: 1.42 }),
  ];
  const sel = resolveCanonicalGcf({ spreadRows: [], factRows: rows });
  const readiness = resolveGcfFactValue(rows).value;
  assert.equal(sel.value, 412_000);
  assert.equal(sel.value, readiness); // readiness & selector agree by construction
  assert.equal(sel.gcfDscr, 1.42);
});

test("[inv-4] a queued/generating spread row reports computing, not missing", () => {
  // No fact yet, but a compute is in flight.
  const queued = resolveCanonicalGcf({
    spreadRows: [{ status: "queued", owner_type: "GLOBAL", updated_at: "2026-02-01" }],
    factRows: [],
  });
  assert.equal(queued.state, "queued");
  assert.notEqual(queued.state, "missing");

  const generating = resolveCanonicalGcf({
    spreadRows: [{ status: "generating", owner_type: "GLOBAL", updated_at: "2026-02-01" }],
    factRows: [],
  });
  assert.equal(generating.state, "generating");
});

test("[inv-5] a legacy DEAL spread row does not override a current GLOBAL row", () => {
  // GLOBAL row is generating; a stale DEAL row is 'ready'. State must reflect the
  // canonical GLOBAL row (computing), not the stale DEAL row.
  const r = resolveCanonicalGcf({
    spreadRows: [
      { status: "ready", owner_type: "DEAL", updated_at: "2025-01-01" },
      { status: "generating", owner_type: "GLOBAL", updated_at: "2026-02-01" },
    ],
    factRows: [],
  });
  assert.equal(r.state, "generating");
});

test("missing GCF surfaces specific input diagnostics, not generic 'upload docs'", () => {
  const r = resolveCanonicalGcf({ spreadRows: [], factRows: [] });
  assert.equal(r.state, "missing");
  assert.ok(r.diagnostics.length > 0);
  assert.ok(r.diagnostics.some((d) => /CASH_FLOW_AVAILABLE/.test(d)));
  assert.ok(r.diagnostics.some((d) => /ANNUAL_DEBT_SERVICE/.test(d)));
  assert.ok(!r.diagnostics.some((d) => /upload docs/i.test(d)));
});

test("error spread row surfaces the real error_code in diagnostics", () => {
  const r = resolveCanonicalGcf({
    spreadRows: [
      {
        status: "error",
        owner_type: "GLOBAL",
        updated_at: "2026-02-01",
        error: "no facts",
        error_code: "SPREAD_WAITING_ON_FACTS",
      },
    ],
    factRows: [],
  });
  assert.equal(r.state, "error");
  assert.ok(r.diagnostics.some((d) => /SPREAD_WAITING_ON_FACTS/.test(d)));
});

test("superseded facts are ignored", () => {
  const rows = [
    fact({ fact_key: GCF_CANONICAL_FACT_KEY, fact_value_num: 350_000, is_superseded: true }),
  ];
  assert.equal(resolveGcfFactValue(rows).value, null);
});
