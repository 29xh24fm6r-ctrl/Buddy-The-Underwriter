import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") {
    return path.join(process.cwd(), "node_modules/server-only/empty.js");
  }
  return origResolve.call(this, request, ...args);
};

const state = {
  deal: null as Record<string, any> | null,
  score: null as Record<string, any> | null,
  app: null as Record<string, any> | null,
  programs: [] as Array<Record<string, any>>,
};

function makeQB(table: string) {
  const q: any = {
    _filters: {} as Record<string, any>,
    select() {
      return this;
    },
    eq(k: string, v: any) {
      this._filters[k] = v;
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    single() {
      return Promise.resolve({
        data:
          table === "deals"
            ? state.deal
            : table === "buddy_sba_scores"
              ? state.score
              : null,
        error: null,
      });
    },
    maybeSingle() {
      const pick =
        table === "deals"
          ? state.deal
          : table === "buddy_sba_scores"
            ? state.score
            : table === "borrower_applications"
              ? state.app
              : null;
      return Promise.resolve({ data: pick, error: null });
    },
    then(onFulfilled: any) {
      // Only lender_programs uses `then` (list form).
      if (table === "lender_programs") {
        return Promise.resolve({ data: state.programs, error: null }).then(
          onFulfilled,
        );
      }
      return Promise.resolve({ data: [], error: null }).then(onFulfilled);
    },
  };
  return q;
}

const sbStub = { from: (t: string) => makeQB(t) } as any;

const { matchLendersToDeal } =
  require("../matchLenders") as typeof import("../matchLenders");

function resetBase() {
  state.deal = {
    id: "deal-1",
    deal_type: "SBA",
    loan_amount: 500_000,
    state: "WI",
  };
  state.score = { score: 75, band: "selective_fit" };
  state.app = { naics: "722511" };
  state.programs = [];
}

test("no programs provisioned → matched empty + explanatory reason", async () => {
  resetBase();
  const r = await matchLendersToDeal({ dealId: "deal-1", sb: sbStub });
  assert.equal(r.matchCount, 0);
  assert.ok(r.noMatchReasons && r.noMatchReasons[0].includes("no lender programs provisioned"));
});

test("missing score → no match + reason", async () => {
  resetBase();
  state.score = null;
  const r = await matchLendersToDeal({ dealId: "deal-1", sb: sbStub });
  assert.equal(r.matchCount, 0);
  assert.ok(r.noMatchReasons && r.noMatchReasons[0].includes("not ready"));
});

test("score_threshold filter: program with threshold > score excluded", async () => {
  resetBase();
  state.programs = [
    { bank_id: "bank-hi", score_threshold: 80 }, // score 75 < 80
    { bank_id: "bank-lo", score_threshold: 60 },
  ];
  const r = await matchLendersToDeal({ dealId: "deal-1", sb: sbStub });
  assert.deepEqual(r.matched, ["bank-lo"]);
});

test("geography filter: program with explicit state list excludes mismatch", async () => {
  resetBase();
  state.programs = [
    { bank_id: "bank-in", geography: ["WI", "MN"] },
    { bank_id: "bank-out", geography: ["CA", "NY"] },
    { bank_id: "bank-all", geography: ["ALL"] },
  ];
  const r = await matchLendersToDeal({ dealId: "deal-1", sb: sbStub });
  assert.deepEqual(r.matched.sort(), ["bank-all", "bank-in"].sort());
});

test("sba_only filter: non-SBA deal excluded when sba_only=true", async () => {
  resetBase();
  state.deal!.deal_type = "CONVENTIONAL";
  state.programs = [
    { bank_id: "bank-sba", sba_only: true },
    { bank_id: "bank-any", sba_only: false },
  ];
  const r = await matchLendersToDeal({ dealId: "deal-1", sb: sbStub });
  assert.deepEqual(r.matched, ["bank-any"]);
});

test("asset_types filter: NAICS-prefix mismatch excludes", async () => {
  resetBase();
  // NAICS 722511 → prefix 72. Program asset_types "51" (not a match).
  state.programs = [
    { bank_id: "bank-hospitality", asset_types: ["72"] },
    { bank_id: "bank-manufacturing", asset_types: ["31"] },
    { bank_id: "bank-any", asset_types: ["ALL"] },
  ];
  const r = await matchLendersToDeal({ dealId: "deal-1", sb: sbStub });
  assert.deepEqual(r.matched.sort(), ["bank-any", "bank-hospitality"].sort());
});

test("dedup: same bank_id across multiple program rows returns once", async () => {
  resetBase();
  state.programs = [
    { bank_id: "bank-1" },
    { bank_id: "bank-1" },
    { bank_id: "bank-2" },
  ];
  const r = await matchLendersToDeal({ dealId: "deal-1", sb: sbStub });
  assert.deepEqual(r.matched.sort(), ["bank-1", "bank-2"]);
});

test("cap at 10 lenders", async () => {
  resetBase();
  state.programs = Array.from({ length: 15 }, (_, i) => ({
    bank_id: `bank-${i}`,
  }));
  const r = await matchLendersToDeal({ dealId: "deal-1", sb: sbStub });
  assert.equal(r.matched.length, 10);
});

test("happy path: all filters pass → matched populated", async () => {
  resetBase();
  state.programs = [
    {
      bank_id: "bank-good",
      score_threshold: 60,
      sba_only: true,
      geography: ["WI"],
      asset_types: ["72"],
    },
  ];
  const r = await matchLendersToDeal({ dealId: "deal-1", sb: sbStub });
  assert.deepEqual(r.matched, ["bank-good"]);
  assert.equal(r.matchCount, 1);
  assert.equal(r.noMatchReasons, undefined);
});
