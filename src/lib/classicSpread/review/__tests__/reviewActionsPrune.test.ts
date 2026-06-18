/**
 * BUGFIX-CLASSIC-SPREAD-REVIEW-ACTIONS-PRUNE-1 — syncReviewActions reconciles the persisted table to
 * the latest emitted blocker/action set: it upserts current actions AND closes stale OPEN rows whose
 * finding_key is absent from the latest set, without deleting rows or touching banker-decided rows.
 *
 * Uses an in-memory fake of the Supabase query builder (injected via the `client` arg) so the IO
 * reconcile logic is unit-tested without a database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
import type { ClassicSpreadReviewAction } from "../buildReviewActions";

// Shim `import "server-only"` before loading the repo (service-role IO module).
mockServerOnly();
const require = createRequire(import.meta.url);
const { syncReviewActions } = require("../reviewActionsRepo") as typeof import("../reviewActionsRepo");

// ── in-memory Supabase builder fake ─────────────────────────────────────────────────────────────
function makeFakeClient(initialRows: any[]) {
  const store = { rows: initialRows.map((r) => ({ ...r })), deleteCalls: 0, upsertCalls: 0, updateCalls: 0 };

  const matches = (row: any, filters: [string, any][], inFilters: [string, Set<any>][]) => {
    for (const [c, v] of filters) if (row[c] !== v) return false;
    for (const [c, set] of inFilters) if (!set.has(row[c])) return false;
    return true;
  };

  const makeBuilder = () => {
    const state: { op: string | null; filters: [string, any][]; inFilters: [string, Set<any>][]; payload: any; upsertRows: any[] | null } = {
      op: null, filters: [], inFilters: [], payload: null, upsertRows: null,
    };
    const exec = () => {
      if (state.op === "upsert") {
        store.upsertCalls++;
        for (const r of state.upsertRows ?? []) {
          const idx = store.rows.findIndex((x) => x.bank_id === r.bank_id && x.deal_id === r.deal_id && x.finding_key === r.finding_key);
          if (idx >= 0) store.rows[idx] = { ...store.rows[idx], ...r }; // r omits status/reviewer → preserved
          else store.rows.push({ id: `gen-${store.rows.length + 1}`, status: "open", reviewer_user_id: null, decision_json: null, reviewed_at: null, ...r });
        }
        return { data: null, error: null };
      }
      if (state.op === "select") {
        return { data: store.rows.filter((r) => matches(r, state.filters, state.inFilters)).map((r) => ({ ...r })), error: null };
      }
      if (state.op === "update") {
        store.updateCalls++;
        for (const row of store.rows) if (matches(row, state.filters, state.inFilters)) Object.assign(row, state.payload);
        return { data: null, error: null };
      }
      if (state.op === "delete") { store.deleteCalls++; return { data: null, error: null }; }
      return { data: null, error: null };
    };
    const builder: any = {
      upsert(rows: any[], _opts: any) { state.op = "upsert"; state.upsertRows = rows; return builder; },
      select(_cols: string) { state.op = "select"; return builder; },
      update(payload: any) { state.op = "update"; state.payload = payload; return builder; },
      delete() { state.op = "delete"; return builder; },
      eq(c: string, v: any) { state.filters.push([c, v]); return builder; },
      in(c: string, vals: any[]) { state.inFilters.push([c, new Set(vals)]); return builder; },
      then(resolve: (v: any) => void, reject?: (e: any) => void) {
        try { resolve(exec()); } catch (e) { if (reject) reject(e); else throw e; }
      },
    };
    return builder;
  };

  return { client: { from: (_t: string) => makeBuilder() }, store };
}

const action = (findingKey: string, severity = "blocker"): ClassicSpreadReviewAction => ({
  findingKey,
  periodLabel: "2025",
  statement: "balance_sheet",
  rowLabel: findingKey,
  actionType: "CONFIRM_RESOLVED_VALUE",
  issueType: "rejected_source_value",
  severity,
  recommendedValue: 1,
  sourceValue: 2,
  diffValue: 1,
  sourceDocumentId: null,
  findingJson: {} as any,
});

const openRow = (findingKey: string, overrides: Record<string, any> = {}) => ({
  id: `row-${findingKey}`,
  deal_id: "deal-1",
  bank_id: "bank-1",
  finding_key: findingKey,
  status: "open",
  reviewer_user_id: null,
  decision_json: null,
  reviewed_at: null,
  ...overrides,
});

const rowByFinding = (store: any, fk: string) => store.rows.find((r: any) => r.finding_key === fk);

describe("syncReviewActions reconcile/prune", () => {
  it("closes a stale OPEN row absent from the latest emitted actions", async () => {
    const { client, store } = makeFakeClient([openRow("STALE_A"), openRow("KEEP_B")]);
    const res = await syncReviewActions({ dealId: "deal-1", bankId: "bank-1", actions: [action("KEEP_B")], client });
    assert.equal(res.closed, 1);
    assert.equal(rowByFinding(store, "STALE_A").status, "closed");
    assert.equal(rowByFinding(store, "STALE_A").decision_json.system_closed, true);
    assert.equal(rowByFinding(store, "STALE_A").decision_json.reason, "absent_from_latest_audit");
    assert.equal(rowByFinding(store, "STALE_A").reviewer_user_id, null); // system close, not a banker decision
  });

  it("preserves banker-decided / resolved / waived rows even when absent from the latest set", async () => {
    const { client, store } = makeFakeClient([
      openRow("DECIDED_C", { status: "confirmed_resolved_value", reviewer_user_id: "user_x", decision_json: { by: "user_x" } }),
      openRow("WAIVED_D", { status: "waived", reviewer_user_id: "user_y" }),
      openRow("CLOSED_E", { status: "closed" }),
    ]);
    await syncReviewActions({ dealId: "deal-1", bankId: "bank-1", actions: [], client });
    assert.equal(rowByFinding(store, "DECIDED_C").status, "confirmed_resolved_value");
    assert.equal(rowByFinding(store, "DECIDED_C").reviewer_user_id, "user_x");
    assert.deepEqual(rowByFinding(store, "DECIDED_C").decision_json, { by: "user_x" }); // untouched
    assert.equal(rowByFinding(store, "WAIVED_D").status, "waived");
    assert.equal(rowByFinding(store, "CLOSED_E").status, "closed");
  });

  it("SPEC-LINKED-EVIDENCE-REGENERATE-CLOSE-LOOP-1: closes a stale borrower_detail_requested row (request fulfilled, finding gone)", async () => {
    const { client, store } = makeFakeClient([
      openRow("TCA_2026", { status: "borrower_detail_requested", reviewer_user_id: "user_banker" }),
    ]);
    // latest audit no longer emits TCA_2026 → the regenerate consumed the borrower's linked evidence
    const res = await syncReviewActions({ dealId: "deal-1", bankId: "bank-1", actions: [], client });
    assert.equal(res.closed, 1);
    assert.equal(rowByFinding(store, "TCA_2026").status, "closed");
    assert.equal(rowByFinding(store, "TCA_2026").decision_json.system_closed, true);
    assert.equal(rowByFinding(store, "TCA_2026").reviewer_user_id, "user_banker"); // requesting banker kept on record
  });

  it("does NOT close a borrower_detail_requested row while its finding is still emitted (upload != cleared)", async () => {
    const { client, store } = makeFakeClient([
      openRow("TCA_2026", { status: "borrower_detail_requested", reviewer_user_id: "user_banker" }),
    ]);
    const res = await syncReviewActions({ dealId: "deal-1", bankId: "bank-1", actions: [action("TCA_2026")], client });
    assert.equal(res.closed, 0);
    assert.equal(rowByFinding(store, "TCA_2026").status, "borrower_detail_requested"); // still blocking
  });

  it("still closes stale OPEN rows when the latest audit has ZERO actions", async () => {
    const { client, store } = makeFakeClient([openRow("STALE_A"), openRow("STALE_B")]);
    const res = await syncReviewActions({ dealId: "deal-1", bankId: "bank-1", actions: [], client });
    assert.equal(res.closed, 2);
    assert.equal(rowByFinding(store, "STALE_A").status, "closed");
    assert.equal(rowByFinding(store, "STALE_B").status, "closed");
  });

  it("upserts a current action and leaves it OPEN", async () => {
    const { client, store } = makeFakeClient([]);
    await syncReviewActions({ dealId: "deal-1", bankId: "bank-1", actions: [action("NEW_B")], client });
    const b = rowByFinding(store, "NEW_B");
    assert.ok(b, "current action must be inserted");
    assert.equal(b.status, "open");
    assert.equal(b.action_type, "CONFIRM_RESOLVED_VALUE");
  });

  it("never performs a delete", async () => {
    const { client, store } = makeFakeClient([openRow("STALE_A"), openRow("KEEP_B")]);
    await syncReviewActions({ dealId: "deal-1", bankId: "bank-1", actions: [action("KEEP_B")], client });
    assert.equal(store.deleteCalls, 0);
  });

  it("scopes the prune strictly to (bank_id, deal_id)", async () => {
    const { client, store } = makeFakeClient([
      openRow("STALE_A"), // deal-1 / bank-1 — should close
      openRow("OTHER_DEAL", { id: "row-od", deal_id: "deal-2" }), // different deal — must stay open
      openRow("OTHER_BANK", { id: "row-ob", bank_id: "bank-2" }), // different bank — must stay open
    ]);
    await syncReviewActions({ dealId: "deal-1", bankId: "bank-1", actions: [], client });
    assert.equal(rowByFinding(store, "STALE_A").status, "closed");
    assert.equal(rowByFinding(store, "OTHER_DEAL").status, "open");
    assert.equal(rowByFinding(store, "OTHER_BANK").status, "open");
  });

  it("refreshes audit fields of a current action without overwriting its banker decision", async () => {
    const { client, store } = makeFakeClient([
      openRow("KEEP_B", { status: "source_verified", reviewer_user_id: "user_z", severity: "blocker", action_type: "OLD" }),
    ]);
    await syncReviewActions({ dealId: "deal-1", bankId: "bank-1", actions: [action("KEEP_B")], client });
    const b = rowByFinding(store, "KEEP_B");
    assert.equal(b.status, "source_verified"); // decision preserved
    assert.equal(b.reviewer_user_id, "user_z");
    assert.equal(b.action_type, "CONFIRM_RESOLVED_VALUE"); // audit field refreshed
  });
});
