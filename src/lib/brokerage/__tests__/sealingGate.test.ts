import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

// In-memory Supabase stub. Each test resets via the `state` object.
type Rows = Record<string, Record<string, any>>;
const state = {
  score: null as Record<string, any> | null,
  assumptions: null as Record<string, any> | null,
  preview: null as Record<string, any> | null,
  validation: null as Record<string, any> | null,
  sealed: null as Record<string, any> | null,
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
    is() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle() {
      const pick = (
        {
          buddy_sba_scores: state.score,
          buddy_sba_assumptions: state.assumptions,
          buddy_trident_bundles: state.preview,
          buddy_validation_reports: state.validation,
          buddy_sealed_packages: state.sealed,
        } as Rows
      )[table];
      return Promise.resolve({ data: pick ?? null, error: null });
    },
  };
  return q;
}

const sbStub = { from: (t: string) => makeQB(t) } as any;

const { canSeal } = require("../sealingGate") as typeof import("../sealingGate");

function resetHappy() {
  state.score = { score: 75, band: "selective_fit", eligibility_passed: true };
  state.assumptions = {
    status: "confirmed",
    loan_impact: { termMonths: 120, loanAmount: 500_000 },
  };
  state.preview = { id: "trident-1" };
  state.validation = { overall_status: "PASS" };
  state.sealed = null;
}

test("happy path passes all gates", async () => {
  resetHappy();
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, true);
});

test("missing locked score blocks", async () => {
  resetHappy();
  state.score = null;
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.ok(r.reasons.some((s) => s.includes("No locked Buddy SBA Score")));
});

test("score below 60 blocks", async () => {
  resetHappy();
  state.score = { score: 55, band: "specialty_lender", eligibility_passed: true };
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.reasons.some((s) => s.includes("55 is below the 60")));
});

test("band='not_eligible' blocks", async () => {
  resetHappy();
  state.score = { score: 40, band: "not_eligible", eligibility_passed: false };
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.reasons.some((s) => s.includes("not_eligible")));
});

test("eligibility_passed=false blocks", async () => {
  resetHappy();
  state.score = { score: 70, band: "selective_fit", eligibility_passed: false };
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.ok(r.reasons.some((s) => s.includes("eligibility checks did not pass")));
});

test("assumptions not confirmed blocks", async () => {
  resetHappy();
  state.assumptions = { status: "draft", loan_impact: {} };
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.ok(r.reasons.some((s) => s.includes("assumptions not yet confirmed")));
});

test("loan_impact.termMonths missing blocks", async () => {
  resetHappy();
  state.assumptions = {
    status: "confirmed",
    loan_impact: { loanAmount: 500_000 },
  };
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.ok(r.reasons.some((s) => s.includes("termMonths")));
});

test("loan_impact.loanAmount missing blocks", async () => {
  resetHappy();
  state.assumptions = {
    status: "confirmed",
    loan_impact: { termMonths: 120 },
  };
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.ok(r.reasons.some((s) => s.includes("loanAmount")));
});

test("preview trident bundle missing blocks", async () => {
  resetHappy();
  state.preview = null;
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.ok(r.reasons.some((s) => s.includes("Preview trident bundle")));
});

test("validation FAIL blocks", async () => {
  resetHappy();
  state.validation = { overall_status: "FAIL" };
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.ok(r.reasons.some((s) => s.includes("Validation report is in FAIL")));
});

test("already sealed blocks", async () => {
  resetHappy();
  state.sealed = { id: "seal-1" };
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.ok(r.reasons.some((s) => s.includes("already sealed")));
});

test("multiple blockers accumulated", async () => {
  resetHappy();
  state.score = null;
  state.preview = null;
  state.validation = { overall_status: "FAIL" };
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.reasons.length >= 3);
});
