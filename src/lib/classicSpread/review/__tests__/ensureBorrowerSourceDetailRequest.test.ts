/**
 * SPEC-CLASSIC-SPREAD-BORROWER-SOURCE-DETAIL-REQUEST-1 — wiring the review action to the borrower
 * draft-request surface (`draft_borrower_requests`), idempotently.
 *
 * Uses an in-memory fake of the Supabase query builder (injected via `client`) so the IO is unit
 * tested without a database. Proves: first request inserts; a second request for the SAME finding_key
 * reuses the existing draft (no duplicate); evidence links back to the finding/review action; a
 * different finding_key creates a separate draft; and the review-actions table is never touched.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
import type { SourceDetailRequestInput } from "../sourceDetailRequestBuilder";

mockServerOnly();
const require = createRequire(import.meta.url);
const { ensureBorrowerSourceDetailRequest } =
  require("../ensureBorrowerSourceDetailRequest") as typeof import("../ensureBorrowerSourceDetailRequest");

// ── in-memory Supabase builder fake (supports select/insert/update + eq/in + maybeSingle/then) ────
function makeFakeClient(seed: Record<string, any[]> = {}) {
  const store: Record<string, any[]> = {};
  for (const [t, rows] of Object.entries(seed)) store[t] = rows.map((r) => ({ ...r }));
  const touched = new Set<string>();
  let idSeq = 0;

  const makeBuilder = (table: string) => {
    store[table] = store[table] ?? [];
    const state: any = { op: null, filters: [], inFilter: null, payload: null, insertRow: null };
    const matches = (row: any) => {
      for (const [c, v] of state.filters) if (row[c] !== v) return false;
      if (state.inFilter) { const [c, set] = state.inFilter; if (!set.has(row[c])) return false; }
      return true;
    };
    const exec = () => {
      if (state.op === "insert") {
        touched.add(table);
        const row = { id: `gen-${++idSeq}`, ...state.insertRow };
        store[table].push(row);
        return { data: { id: row.id }, error: null, _row: row };
      }
      if (state.op === "select") {
        return { data: store[table].filter(matches).map((r: any) => ({ ...r })), error: null };
      }
      if (state.op === "update") {
        touched.add(table);
        for (const row of store[table]) if (matches(row)) Object.assign(row, state.payload);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };
    const single = () => {
      const res = exec();
      const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data ?? null;
      return { data, error: res.error };
    };
    const builder: any = {
      select(_c?: string) { if (!state.op) state.op = "select"; return builder; },
      insert(row: any) { state.op = "insert"; state.insertRow = row; return builder; },
      update(payload: any) { state.op = "update"; state.payload = payload; return builder; },
      eq(c: string, v: any) { state.filters.push([c, v]); return builder; },
      in(c: string, vals: any[]) { state.inFilter = [c, new Set(vals)]; return builder; },
      maybeSingle() { return Promise.resolve(single()); },
      then(resolve: (v: any) => void, reject?: (e: any) => void) {
        try { resolve(exec()); } catch (e) { if (reject) reject(e); else throw e; }
      },
    };
    return builder;
  };

  return { client: { from: (t: string) => makeBuilder(t) }, store, touched };
}

const tcaInput = (over: Partial<SourceDetailRequestInput> = {}): SourceDetailRequestInput => ({
  reviewActionId: "ra-1",
  findingKey: "ytd_2026|balance_sheet|total_current_assets|missing_implied_component",
  actionType: "REQUEST_SOURCE_DETAIL",
  issueType: "missing_implied_component",
  statement: "balance_sheet",
  periodLabel: "YTD 2026",
  periodEndDate: "3/31/2026",
  periodIsInterim: true,
  lineItem: "TOTAL CURRENT ASSETS",
  sourceValue: 198_692.59,
  recommendedValue: 2_898_652.37,
  diffValue: 2_898_652.37,
  ...over,
});

describe("ensureBorrowerSourceDetailRequest", () => {
  it("creates a borrower draft on first request, linking evidence back to the finding/review action", async () => {
    const { client, store } = makeFakeClient();
    const res = await ensureBorrowerSourceDetailRequest({ dealId: "deal-1", input: tcaInput(), client });

    assert.equal(res.created, true);
    assert.equal(res.alreadyRequested, false);
    assert.ok(res.borrowerRequestId);
    assert.equal(store.draft_borrower_requests.length, 1);

    const row = store.draft_borrower_requests[0];
    assert.equal(row.deal_id, "deal-1");
    assert.equal(row.status, "pending_approval"); // never auto-sent
    assert.match(row.draft_subject, /Upload 3\/31\/2026 current asset detail/);
    const ev = row.evidence[0];
    assert.equal(ev.source_finding_key, tcaInput().findingKey);
    assert.equal(ev.source_review_action_id, "ra-1");
    assert.equal(ev.tie_out_target_amount, 198_692.59 + 2_898_652.37);
  });

  it("is idempotent: a second request for the same finding_key reuses the draft (no duplicate)", async () => {
    const { client, store } = makeFakeClient();
    const first = await ensureBorrowerSourceDetailRequest({ dealId: "deal-1", input: tcaInput(), client });
    const second = await ensureBorrowerSourceDetailRequest({ dealId: "deal-1", input: tcaInput(), client });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.alreadyRequested, true);
    assert.equal(second.borrowerRequestId, first.borrowerRequestId);
    assert.equal(store.draft_borrower_requests.length, 1); // still ONE row
  });

  it("creates a separate draft for a different finding_key (different period/line)", async () => {
    const { client, store } = makeFakeClient();
    await ensureBorrowerSourceDetailRequest({ dealId: "deal-1", input: tcaInput(), client });
    await ensureBorrowerSourceDetailRequest({
      dealId: "deal-1",
      input: tcaInput({ findingKey: "2025|balance_sheet|accounts_receivable|missing_required_value", lineItem: "ACCOUNTS RECEIVABLE", periodLabel: "2025", periodEndDate: "12/31/2025" }),
      client,
    });
    assert.equal(store.draft_borrower_requests.length, 2);
  });

  it("works for a different deal id / bank scope without OmniCare assumptions", async () => {
    const { client, store } = makeFakeClient();
    const res = await ensureBorrowerSourceDetailRequest({
      dealId: "deal-99",
      input: tcaInput({ findingKey: "2027|balance_sheet|total_current_assets|missing_implied_component", periodLabel: "2027", periodEndDate: "12/31/2027", periodIsInterim: false, sourceValue: 10_000, recommendedValue: 90_000, diffValue: 90_000 }),
      client,
    });
    assert.equal(res.created, true);
    assert.equal(store.draft_borrower_requests[0].deal_id, "deal-99");
    assert.equal(res.request.tieOutTargetAmount, 100_000);
  });

  it("NEVER writes the classic_spread_review_actions table (request creation does not close the action)", async () => {
    const { client, touched } = makeFakeClient();
    await ensureBorrowerSourceDetailRequest({ dealId: "deal-1", input: tcaInput(), client });
    assert.ok(touched.has("draft_borrower_requests"));
    assert.ok(!touched.has("classic_spread_review_actions"));
  });

  it("surfaces a non-fatal error (still returns the built request) when the insert fails", async () => {
    const failing = {
      from: () => ({
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        insert() { return this; },
        maybeSingle() { return Promise.resolve({ data: null, error: { message: "boom" } }); },
        then(resolve: any) { resolve({ data: [], error: null }); },
      }),
    };
    const res = await ensureBorrowerSourceDetailRequest({ dealId: "deal-1", input: tcaInput(), client: failing });
    assert.equal(res.created, false);
    assert.equal(res.borrowerRequestId, null);
    assert.ok(res.error);
    assert.ok(res.request.title.length > 0); // the built request is still returned for the caller
  });
});
