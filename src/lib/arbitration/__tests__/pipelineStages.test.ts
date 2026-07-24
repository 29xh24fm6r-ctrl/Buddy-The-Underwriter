import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { AgentFinding } from "@/lib/agents/types";

let ingestClaimsForDeal: typeof import("@/lib/arbitration/ingestClaims").ingestClaimsForDeal;
let reconcileConflictsForDeal: typeof import("@/lib/arbitration/reconcileConflicts").reconcileConflictsForDeal;
let materializeTruthSnapshotForDeal: typeof import("@/lib/arbitration/materializeTruthSnapshot").materializeTruthSnapshotForDeal;

before(async () => {
  mockServerOnly();
  ({ ingestClaimsForDeal } = await import("@/lib/arbitration/ingestClaims"));
  ({ reconcileConflictsForDeal } = await import("@/lib/arbitration/reconcileConflicts"));
  ({ materializeTruthSnapshotForDeal } = await import("@/lib/arbitration/materializeTruthSnapshot"));
});

/**
 * These 3 functions were extracted verbatim from the POST /arbitration/
 * ingest, /reconcile, /materialize route bodies so
 * src/lib/autopilot/orchestrator.ts can call them in-process instead of an
 * unauthenticated server-to-server fetch back into this same app (that
 * self-fetch had no way to carry the caller's Clerk session, so the
 * pipeline would fail at S3 on every real run). None of this logic had
 * any test coverage before this extraction.
 */

function eligibilityFinding(dealId: string, bankId: string, overallEligible: boolean): AgentFinding {
  return {
    id: `finding-${Math.random().toString(36).slice(2)}`,
    deal_id: dealId,
    bank_id: bankId,
    agent_name: "eligibility",
    agent_version: "1.0.0",
    finding_type: "requirement",
    status: overallEligible ? "pass" : "fail",
    confidence: 0.9,
    input_json: {},
    output_json: { overall_eligible: overallEligible, fatal_issues: [], checks: [] },
    requires_human_review: false,
  };
}

function makeFakeSb(tables: Record<string, any[]> = {}) {
  const state: Record<string, any[]> = { ...tables };
  const calls: Array<{ table: string; op: string }> = [];

  function table(name: string) {
    if (!state[name]) state[name] = [];
    return {
      select() {
        calls.push({ table: name, op: "select" });
        const filters: Array<(row: any) => boolean> = [];
        const builder: any = {
          eq(col: string, val: unknown) {
            filters.push((row) => row[col] === val);
            return builder;
          },
          in(col: string, vals: unknown[]) {
            filters.push((row) => vals.includes(row[col]));
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          single: async () => {
            const rows = state[name].filter((r) => filters.every((f) => f(r)));
            return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } };
          },
          then(resolve: any) {
            const rows = state[name].filter((r) => filters.every((f) => f(r)));
            resolve({ data: rows, error: null });
          },
        };
        return builder;
      },
      insert(rows: any | any[]) {
        const arr = Array.isArray(rows) ? rows : [rows];
        const inserted = arr.map((r, i) => ({ id: `${name}-${state[name].length + i}`, ...r }));
        state[name].push(...inserted);
        return {
          select: () => Promise.resolve({ data: inserted, error: null }),
        };
      },
      upsert(rows: any[]) {
        const inserted = rows.map((r, i) => ({ id: `${name}-${state[name].length + i}`, ...r }));
        state[name].push(...inserted);
        return {
          select: () => Promise.resolve({ data: inserted, error: null }),
        };
      },
      update(patch: any) {
        const filters: Array<(row: any) => boolean> = [];
        const updateBuilder: any = {
          eq(col: string, val: unknown) {
            filters.push((row) => row[col] === val);
            return updateBuilder;
          },
          then(resolve: any) {
            state[name] = state[name].map((r) =>
              filters.every((f) => f(r)) ? { ...r, ...patch } : r,
            );
            resolve({ error: null });
          },
        };
        return updateBuilder;
      },
    };
  }

  return { client: { from: table }, state, calls };
}

test("ingestClaimsForDeal: no findings -> zero counts, no crash", async () => {
  const { client } = makeFakeSb({ agent_findings: [] });
  const result = await ingestClaimsForDeal("deal-1", "bank-1", { sb: client as any });
  assert.equal(result.claims_created, 0);
  assert.equal(result.conflict_sets_created, 0);
  assert.equal(result.message, "No findings to ingest");
});

test("ingestClaimsForDeal: real eligibility finding -> creates claims + conflict sets", async () => {
  const finding = eligibilityFinding("deal-1", "bank-1", true);
  const { client, state } = makeFakeSb({ agent_findings: [finding] });
  const result = await ingestClaimsForDeal("deal-1", "bank-1", { sb: client as any });

  assert.ok(result.claims_created > 0, "eligibility findings normalize into at least one claim");
  assert.ok(result.conflict_sets_created > 0);
  assert.equal(state.agent_claims.length, result.claims_created);
  assert.equal(state.claim_conflict_sets.length, result.conflict_sets_created);
});

test("reconcileConflictsForDeal: no open conflicts -> zero decisions, honest message", async () => {
  const { client } = makeFakeSb({ claim_conflict_sets: [] });
  const result = await reconcileConflictsForDeal("deal-1", "bank-1", { sb: client as any });
  assert.equal(result.decisions_made, 0);
  assert.equal(result.message, "No open conflicts to reconcile");
});

/**
 * S4 "bank overlays" is not a standalone pipeline stage — orchestrator.ts's
 * executeStage4_Overlays is an intentional no-op; the real overlay
 * application happens here, inside S5, via applyBankOverlay:true. This had
 * zero test coverage before this fix, and a live check found zero rows in
 * overlay_application_log / zero active bank_overlays across the whole
 * database — the wiring is real but has never fired for an actual deal yet.
 */
test("reconcileConflictsForDeal: applyBankOverlay:true + active overlay -> logs to overlay_application_log", async () => {
  const { client, state } = makeFakeSb({
    claim_conflict_sets: [
      { id: "cs-1", deal_id: "deal-1", bank_id: "bank-1", status: "open", claim_hash: "hash-1", topic: "dscr" },
    ],
    agent_claims: [
      {
        id: "claim-1",
        deal_id: "deal-1",
        claim_hash: "hash-1",
        finding_id: "finding-1",
        topic: "dscr",
        predicate: "global_dscr",
        value_json: { value: 1.25 },
        severity: "info",
        sop_citations: [],
        evidence_json: null,
      },
    ],
    bank_overlays: [
      {
        id: "overlay-1",
        bank_id: "bank-1",
        version: 1,
        is_active: true,
        overlay_json: {
          bank_id: "bank-1",
          version: 1,
          name: "Test Overlay",
          constraints: {},
          risk_triggers: [],
          doc_requirements: [],
          arbitration_overrides: {},
        },
      },
    ],
  });

  const result = await reconcileConflictsForDeal("deal-1", "bank-1", {
    sb: client as any,
    applyBankOverlay: true,
  });

  assert.equal(result.decisions_made, 1);
  assert.equal(result.overlay_applied, true);
  assert.equal(state.overlay_application_log.length, 1);
  assert.equal(state.overlay_application_log[0].overlay_id, "overlay-1");
});

test("materializeTruthSnapshotForDeal: no decisions -> truth_snapshot_created false, honest message", async () => {
  const { client } = makeFakeSb({ arbitration_decisions: [] });
  const result = await materializeTruthSnapshotForDeal("deal-1", "bank-1", { sb: client as any });
  assert.equal(result.truth_snapshot_created, false);
  assert.equal(result.message, "No decisions to materialize");
});

// A "real decision -> creates snapshot" happy-path test is deliberately
// not included here: on success, materializeTruthSnapshotForDeal calls the
// pre-existing (unmodified by this change) fireDealTruthEvent(), which
// constructs its own real supabaseAdmin() client internally rather than
// accepting DI — the same ESM-module-mocking fragility already documented
// in submitCreditMemoToUnderwriting.lifecycleIntegration.test.ts's header
// comment applies here. The happy path is instead verified at the schema
// level (a live insert/select smoke test against the real
// deal_truth_snapshots table, run and cleaned up during this fix).
