/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — generateProjectionsAssumptionsNarrative
 * tests. Same require.cache stubbing for @/lib/supabase/admin as
 * loadProjectionInputs.test.ts (loadDealMethodology reaches for it
 * internally), plus the gateway's provider-impl test seam for the
 * generator and verifier role calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  function builder(tableName: string) {
    const stored = tables[tableName] ?? (tables[tableName] = []);
    let rows = stored;
    let op: "select" | "insert" = "select";
    let payload: any = null;

    const q: any = {
      select() {
        return q;
      },
      eq(col: string, val: any) {
        rows = rows.filter((r) => r[col] === val);
        return q;
      },
      neq(col: string, val: any) {
        rows = rows.filter((r) => r[col] !== val);
        return q;
      },
      in(col: string, vals: any[]) {
        rows = rows.filter((r) => vals.includes(r[col]));
        return q;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        const asc = opts?.ascending !== false;
        rows = [...rows].sort((a, b) => {
          if (a[col] === b[col]) return 0;
          return (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1);
        });
        return q;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return q;
      },
      insert(p: any) {
        op = "insert";
        payload = p;
        return q;
      },
      maybeSingle() {
        if (op === "insert") return Promise.resolve(execInsert());
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(onFulfilled: any, onRejected: any) {
        const result = op === "insert" ? execInsert() : { data: rows, error: null };
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    };

    function execInsert() {
      stored.push({ id: `gen-${stored.length + 1}`, ...payload });
      return { data: null, error: null };
    }

    return q;
  }
  return { from: builder };
}

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "supabase-admin-stub",
  filename: "supabase-admin-stub",
  loaded: true,
  exports: { supabaseAdmin: () => makeDb({ deal_methodology_choices: [] }) },
} as any;

const { generateProjectionsAssumptionsNarrative } =
  require("../projectionsAssumptionsNarrative") as typeof import("../projectionsAssumptionsNarrative");
const { __setProviderImplForTests, __resetGatewayTestOverrides, __resetGatewayBudgetForTests } =
  require("../../ai/gateway") as typeof import("../../ai/gateway");
const { __setVendorApprovalForTests, __resetVendorApprovalForTests } =
  require("../../ai/vendorApproval") as typeof import("../../ai/vendorApproval");

test.beforeEach(() => {
  __setVendorApprovalForTests("google", "APPROVED");
  __setVendorApprovalForTests("openai", "APPROVED");
  __setVendorApprovalForTests("anthropic", "APPROVED");
});

test.afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
  __resetVendorApprovalForTests();
});

function baseFactRows(): Row[] {
  return [
    {
      deal_id: "deal-1",
      bank_id: "bank-1",
      fact_key: "NET_INCOME",
      fact_value_num: 200000,
      fact_period_end: "2025-12-31",
      is_superseded: false,
      resolution_status: "accepted",
    },
    {
      deal_id: "deal-1",
      bank_id: "bank-1",
      fact_key: "ORDINARY_BUSINESS_INCOME",
      fact_value_num: 200000,
      fact_period_end: "2025-12-31",
      is_superseded: false,
      resolution_status: "accepted",
    },
  ];
}

function makeDealDb() {
  return makeDb({
    deal_structural_pricing: [{ deal_id: "deal-1", annual_debt_service_est: 100000, computed_at: "2026-01-01" }],
    deal_financial_facts: baseFactRows(),
  });
}

function setGeneratorResponse(narrative: string) {
  __setProviderImplForTests("openai", async () => ({
    text: JSON.stringify({ narrative }),
    tokensIn: 100,
    tokensOut: 50,
  }));
}

function setVerifierResponse(flaggedClaims: unknown[]) {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ flaggedClaims }),
    tokensIn: 50,
    tokensOut: 20,
  }));
}

test("returns unavailable when the deal isn't projectable yet", async () => {
  const db = makeDb({ deal_structural_pricing: [] });
  const result = await generateProjectionsAssumptionsNarrative("deal-1", "bank-1", db);
  assert.equal(result.status, "unavailable");
});

test("returns ready with the narrative when the verifier finds nothing unsupported", async () => {
  setGeneratorResponse("EBITDA and NCADS support a projected DSCR of 2.00x against $100,000 of proposed debt service.");
  setVerifierResponse([]);
  const db = makeDealDb();

  const result = await generateProjectionsAssumptionsNarrative("deal-1", "bank-1", db);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.match(result.narrative, /2\.00x/);
    assert.ok(result.disclaimer.length > 0);
  }
});

test("degrades to a generic message when the verifier raises a critical flag", async () => {
  setGeneratorResponse("DSCR is 4.00x, far above what the facts show.");
  setVerifierResponse([
    { claim: "DSCR is 4.00x", reason: "Facts show a projected DSCR of 2.00x, not 4.00x.", severity: "critical" },
  ]);
  const tables: Record<string, Row[]> = {
    deal_structural_pricing: [{ deal_id: "deal-1", annual_debt_service_est: 100000, computed_at: "2026-01-01" }],
    deal_financial_facts: baseFactRows(),
  };
  const db = makeDb(tables);

  const result = await generateProjectionsAssumptionsNarrative("deal-1", "bank-1", db);
  assert.equal(result.status, "degraded");
  assert.equal(tables.deal_conditions?.length, 1, "a critical flag opens a banker task");
});

test("degrades gracefully when the generator call fails outright", async () => {
  __setProviderImplForTests("openai", async () => {
    throw new Error("provider unavailable");
  });
  const db = makeDealDb();

  const result = await generateProjectionsAssumptionsNarrative("deal-1", "bank-1", db);
  assert.equal(result.status, "degraded");
});
