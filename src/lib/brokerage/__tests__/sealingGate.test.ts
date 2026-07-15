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
  // Ticket 2: owners (ownership_entities rows) + a set of ownership_entity_ids
  // with a completed IAL2 verification (borrower_identity_verifications).
  owners: [] as Array<{ id: string; display_name: string | null; ownership_pct: number }>,
  verifiedOwnerIds: new Set<string>(),
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
    in(k: string, v: any) {
      this._filters[k] = { in: v };
      return this;
    },
    not() {
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
      if (table === "borrower_identity_verifications") {
        const ownerId = this._filters["ownership_entity_id"];
        const verified = state.verifiedOwnerIds.has(ownerId);
        return Promise.resolve({
          data: verified ? { id: `verification-${ownerId}`, completed_at: new Date().toISOString() } : null,
          error: null,
        });
      }
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
    // Array-returning queries with no terminal .maybeSingle() call —
    // ownersNeedingIal2's ownership_entities lookup.
    then(resolve: (r: { data: any; error: null }) => void) {
      const data = table === "ownership_entities" ? state.owners : [];
      resolve({ data, error: null });
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
  state.owners = [];
  state.verifiedOwnerIds = new Set();
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

// Ticket 2 (SPEC-BROKERAGE-SBA-READY-V1) — identity verification gate.
test("owner below 20% ownership does not require IAL2", async () => {
  resetHappy();
  state.owners = [{ id: "owner-minor", display_name: "Minor Owner", ownership_pct: 10 }];
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, true);
});

test("owner at/above 20% ownership without IAL2 blocks", async () => {
  resetHappy();
  state.owners = [{ id: "owner-major", display_name: "Major Owner", ownership_pct: 25 }];
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok)
    assert.ok(r.reasons.some((s) => s.includes("Major Owner") && s.includes("identity verification")));
});

test("owner at/above 20% ownership with completed IAL2 does not block", async () => {
  resetHappy();
  state.owners = [{ id: "owner-major", display_name: "Major Owner", ownership_pct: 25 }];
  state.verifiedOwnerIds = new Set(["owner-major"]);
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, true);
});

test("multiple unverified majority owners each produce a blocker reason", async () => {
  resetHappy();
  state.owners = [
    { id: "owner-a", display_name: "Owner A", ownership_pct: 60 },
    { id: "owner-b", display_name: "Owner B", ownership_pct: 40 },
  ];
  const r = await canSeal("deal-1", sbStub);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.reasons.some((s) => s.includes("Owner A")));
    assert.ok(r.reasons.some((s) => s.includes("Owner B")));
  }
});
