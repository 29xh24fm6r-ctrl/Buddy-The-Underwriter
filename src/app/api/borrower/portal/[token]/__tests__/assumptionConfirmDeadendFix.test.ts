/**
 * SPEC-ASSUMPTION-CONFIRM-DEADEND-FIX-V1 — the path live data showed
 * actually happening in production: research-projections fails/throws
 * (Path 1 from the spec), the borrower lands in "editing" with no
 * briefing, and — before this fix — there was no confirm control
 * reachable from there at all (buddy_sba_assumptions: 8/8 rows stuck at
 * status='draft' forever). This test exercises the server side of that
 * path end to end: the failed research call is logged, a subsequent
 * confirm (what the new "editing"-phase Confirm button now calls) always
 * succeeds regardless of research having failed, and confirming triggers
 * generateTridentBundle — the second gap the spec explicitly warned might
 * exist "immediately behind" the first one (it did: /generate-pdf never
 * called it).
 *
 * Same require.cache module-stub convention as
 * src/app/api/brokerage/voice/__tests__/dispatchAuthz.test.ts — this route
 * tree has no other test precedent, so this establishes it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

type Row = Record<string, any>;

const state: {
  assumptions: Row[];
  events: Row[];
  researchShouldThrow: boolean;
  bundleResult: any;
} = {
  assumptions: [],
  events: [],
  researchShouldThrow: false,
  bundleResult: { ok: true, bundleId: "bundle-1", mode: "preview", paths: {}, businessPlanAttested: false },
};

function resetState() {
  state.assumptions = [];
  state.events = [];
  state.researchShouldThrow = false;
  state.bundleResult = { ok: true, bundleId: "bundle-1", mode: "preview", paths: {}, businessPlanAttested: false };
}

function makeQueryBuilder(tableName: string) {
  const q: any = {
    _filters: [] as Array<[string, any]>,
    _op: "select" as "select" | "insert" | "upsert",
    _payload: null as any,
    _conflictKeys: [] as string[],
    select() {
      return this;
    },
    eq(col: string, val: any) {
      this._filters.push([col, val]);
      return this;
    },
    insert(payload: any) {
      this._op = "insert";
      this._payload = payload;
      return this;
    },
    upsert(payload: any, opts?: { onConflict?: string }) {
      this._op = "upsert";
      this._payload = payload;
      this._conflictKeys = (opts?.onConflict ?? "").split(",").filter(Boolean);
      return this;
    },
    maybeSingle() {
      const rows = this._exec();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(onFulfilled: any) {
      return Promise.resolve(this._exec2()).then(onFulfilled);
    },
    _exec(): Row[] {
      const source = ({ buddy_sba_assumptions: state.assumptions, buddy_sba_assumptions_events: state.events } as Record<string, Row[]>)[tableName];
      if (!source) return [];
      return source.filter((row) => this._filters.every(([k, v]: any) => row[k] === v));
    },
    _exec2(): { data: any; error: null } {
      const source = ({ buddy_sba_assumptions: state.assumptions, buddy_sba_assumptions_events: state.events } as Record<string, Row[]>)[tableName];
      if (!source) return { data: [], error: null };
      if (this._op === "insert") {
        source.push({ id: `row-${source.length + 1}`, ...this._payload });
        return { data: null, error: null };
      }
      if (this._op === "upsert") {
        const existing = this._conflictKeys.length
          ? source.find((r) => this._conflictKeys.every((k: string) => r[k] === this._payload[k]))
          : undefined;
        if (existing) Object.assign(existing, this._payload);
        else source.push({ id: `row-${source.length + 1}`, ...this._payload });
        return { data: null, error: null };
      }
      return { data: this._exec(), error: null };
    },
  };
  return q;
}

const supabaseStub = {
  from(t: string) {
    return makeQueryBuilder(t);
  },
};

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "sb-stub",
  filename: "sb-stub",
  loaded: true,
  exports: { supabaseAdmin: () => supabaseStub },
} as any;

require.cache[require.resolve("@/lib/borrower/resolvePortalContext")] = {
  id: "portal-ctx-stub",
  filename: "portal-ctx-stub",
  loaded: true,
  exports: {
    resolvePortalContext: async (token: string) => ({
      dealId: `deal-for-${token}`,
      bankId: `bank-for-${token}`,
    }),
  },
} as any;

require.cache[require.resolve("@/lib/sba/sbaResearchProjectionGenerator")] = {
  id: "research-gen-stub",
  filename: "research-gen-stub",
  loaded: true,
  exports: {
    generateProjectionsFromResearch: async () => {
      if (state.researchShouldThrow) {
        throw new Error("simulated research generation failure");
      }
      return {
        assumptions: {
          revenueStreams: [],
          costAssumptions: {},
          workingCapital: {},
          loanImpact: {},
          managementTeam: [],
        },
        researchNarrative: "narrative",
        researchContext: {},
        confidenceLevel: "medium",
        dataSources: [],
      };
    },
  },
} as any;

require.cache[require.resolve("@/lib/brokerage/trident/generateTridentBundle")] = {
  id: "trident-bundle-stub",
  filename: "trident-bundle-stub",
  loaded: true,
  exports: {
    generateTridentBundle: async () => state.bundleResult,
  },
} as any;

const { POST: researchProjectionsPOST } =
  require("../research-projections/route") as typeof import("../research-projections/route");
const { PATCH: sbaAssumptionsPATCH } =
  require("../sba-assumptions/route") as typeof import("../sba-assumptions/route");

function mkReq(body?: unknown): any {
  return { json: async () => body ?? {} };
}

async function callResearch(token: string) {
  const res = await researchProjectionsPOST(mkReq(), { params: Promise.resolve({ token }) });
  return { status: res.status, body: await res.json() };
}

async function callConfirm(token: string) {
  const res = await sbaAssumptionsPATCH(mkReq({ patch: { status: "confirmed" } }), {
    params: Promise.resolve({ token }),
  });
  return { status: res.status, body: await res.json() };
}

test.afterEach(() => resetState());

test("research-projections failure is logged to buddy_sba_assumptions_events (Path 1 root cause, previously fully silent)", async () => {
  resetState();
  state.researchShouldThrow = true;

  const r = await callResearch("tok-research-fail");
  assert.equal(r.body.ok, false);

  const event = state.events.find((e) => e.event_type === "research_generation_failed");
  assert.ok(event, "research failure must be logged, not just console.error'd");
  assert.equal(event.deal_id, "deal-for-tok-research-fail");
  assert.match(event.detail.message, /simulated research generation failure/);
});

test("research fails → confirm still succeeds (the actual dead-end this spec fixes) → status is 'confirmed' → trident bundle triggered", async () => {
  resetState();
  state.researchShouldThrow = true;
  const token = "tok-full-path";

  // 1. Research fails — this is what put the borrower in "editing" with
  //    no briefing and (pre-fix) no way to ever reach confirmed.
  const researchResult = await callResearch(token);
  assert.equal(researchResult.body.ok, false);

  // 2. The new "editing"-phase Confirm button calls this exact PATCH.
  //    Must succeed regardless of the research call's outcome above —
  //    research failing must never block confirming.
  const confirmResult = await callConfirm(token);
  assert.equal(confirmResult.status, 200);
  assert.equal(confirmResult.body.ok, true);

  const row = state.assumptions.find((a) => a.deal_id === `deal-for-${token}`);
  assert.ok(row, "confirm must upsert a row even if research never populated one");
  assert.equal(row.status, "confirmed");
  assert.ok(row.confirmed_at);

  // 3. The second gap the spec explicitly flagged: confirming must
  //    actually trigger bundle generation, not just flip a status column.
  assert.equal(confirmResult.body.bundleGeneration?.ok, true);
  assert.equal(confirmResult.body.bundleGeneration?.bundleId, "bundle-1");

  const confirmedEvent = state.events.find((e) => e.event_type === "confirmed");
  assert.ok(confirmedEvent);
  const bundleEvent = state.events.find((e) => e.event_type === "bundle_generation_succeeded");
  assert.ok(bundleEvent);
  assert.equal(bundleEvent.detail.bundleId, "bundle-1");
});

test("bundle generation failure does not undo or fail the assumptions confirmation itself", async () => {
  resetState();
  state.bundleResult = { ok: false, bundleId: null, error: "SBA package generation failed: boom" };
  const token = "tok-bundle-fail";

  const confirmResult = await callConfirm(token);
  assert.equal(confirmResult.status, 200);
  assert.equal(confirmResult.body.ok, true, "confirming the assumptions must succeed independent of bundle generation");
  assert.equal(confirmResult.body.bundleGeneration?.ok, false);

  const row = state.assumptions.find((a) => a.deal_id === `deal-for-${token}`);
  assert.ok(row);
  assert.equal(row.status, "confirmed", "status must still be confirmed even though bundle generation failed");

  const failedEvent = state.events.find((e) => e.event_type === "bundle_generation_failed");
  assert.ok(failedEvent, "bundle failure must be logged — this is exactly the class of gap that made every downstream table sit at 0 rows unnoticed");
  assert.match(failedEvent.detail.error, /SBA package generation failed/);
});

test("a non-confirm PATCH (plain autosave) does not trigger bundle generation", async () => {
  resetState();
  const token = "tok-autosave-only";
  const res = await sbaAssumptionsPATCH(
    mkReq({ patch: { revenueStreams: [{ id: "s1", name: "Sales", baseAnnualRevenue: 100000 }] } }),
    { params: Promise.resolve({ token }) },
  );
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.bundleGeneration, undefined);
  assert.equal(state.events.length, 0);
});
