import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

/**
 * Regression suite for the "borrower starts over" incident.
 *
 * The stub below returns PostgREST ENVELOPES — { data, error, count, status }
 * — because that is what supabase-js actually resolves to, and reading a row
 * field straight off the envelope was the bug. A stub that hands back bare
 * rows makes the broken code pass, which is precisely why the previous
 * "tests" for this route (assert.ok(true) and literals compared to
 * themselves) never caught a query that was misread on every single request.
 */

type Row = Record<string, any>;
type FailFn = (table: string, op: string) => { message: string } | null;

function makeDb(tables: Record<string, Row[]>, opts: { failOn?: FailFn } = {}) {
  function builder(table: string) {
    const rows = tables[table] ?? (tables[table] = []);
    const filters: Array<[string, any]> = [];
    let op: "select" | "insert" | "update" | "upsert" = "select";
    let payload: any = null;
    let wantCount = false;
    let head = false;

    const matches = (r: Row) => filters.every(([k, v]) => r[k] === v);
    const ok = (data: any, count: number | null = null) => ({
      data, error: null, count, status: 200, statusText: "OK",
    });
    const bad = (message: string) => ({
      data: null, error: { message }, count: null, status: 400, statusText: "Bad Request",
    });

    function exec(single: boolean) {
      const forced = opts.failOn?.(table, op);
      if (forced) return bad(forced.message);
      if (op === "insert") {
        const r = { id: `gen-${rows.length + 1}`, ...payload };
        rows.push(r);
        return ok(r);
      }
      if (op === "upsert") {
        const existing = rows.find((r) => r.deal_id === payload.deal_id);
        if (existing) Object.assign(existing, payload);
        else rows.push({ ...payload });
        return ok(null);
      }
      if (op === "update") {
        rows.filter(matches).forEach((r) => Object.assign(r, payload));
        return ok(null);
      }
      const found = rows.filter(matches);
      if (head && wantCount) return ok(null, found.length);
      return ok(single ? (found[0] ?? null) : found, wantCount ? found.length : null);
    }

    const q: any = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        if (o?.count) wantCount = true;
        if (o?.head) head = true;
        return q;
      },
      eq(c: string, v: any) { filters.push([c, v]); return q; },
      order() { return q; },
      limit() { return q; },
      insert(p: any) { op = "insert"; payload = p; return q; },
      update(p: any) { op = "update"; payload = p; return q; },
      upsert(p: any) { op = "upsert"; payload = p; return q; },
      maybeSingle() { return Promise.resolve(exec(true)); },
      then(res: any, rej: any) { return Promise.resolve(exec(false)).then(res, rej); },
    };
    return q;
  }
  return { from: builder };
}

// ── Injected module stubs ───────────────────────────────────────────────
const DEAL = "b296dec2-66c6-4946-8ddc-850daa7f968f";

let db: ReturnType<typeof makeDb>;
let sessionDealId: string | null = DEAL;

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "sb-stub", filename: "sb-stub", loaded: true,
  exports: { supabaseAdmin: () => db },
} as any;

require.cache[require.resolve("@/lib/brokerage/sessionToken")] = {
  id: "session-stub", filename: "session-stub", loaded: true,
  exports: {
    getBorrowerSession: async () =>
      sessionDealId ? { deal_id: sessionDealId, bank_id: "bank1" } : null,
  },
} as any;

const { GET, POST } = require("../route") as typeof import("../route");

/**
 * The production state of deal b296dec2 at the time of the incident:
 * chapter 5 reached, v46, a loan purpose but a zero loan_amount, two owners,
 * five documents, no identity verification yet.
 */
function productionFixture(): Record<string, Row[]> {
  return {
    borrower_intake_progress: [{
      deal_id: DEAL, current_chapter: 5, last_valid_chapter: 4,
      progress_version: 46, last_saved_at: "2026-08-20T18:52:26.696Z",
    }],
    borrower_concierge_sessions: [{
      deal_id: DEAL,
      extracted_facts: { loan: { use_of_proceeds: "start_business" } },
    }],
    deals: [{ id: DEAL, loan_amount: 0, bank_id: "bank1" }],
    ownership_entities: [
      { id: "oe1", deal_id: DEAL, display_name: "Sebrina Colon" },
      { id: "oe2", deal_id: DEAL, display_name: "Matthew Paller" },
    ],
    deal_documents: [1, 2, 3, 4, 5].map((n) => ({ id: `doc${n}`, deal_id: DEAL })),
    borrower_identity_verifications: [],
    borrower_bank_connections: [],
  };
}

async function getJson() {
  const res = await GET();
  return { status: res.status, body: (await res.json()) as any };
}

// ── Tests ───────────────────────────────────────────────────────────────

test("GET returns the persisted position, not a chapter-1 reset", async () => {
  db = makeDb(productionFixture());
  sessionDealId = DEAL;

  const { status, body } = await getJson();
  assert.equal(status, 200);
  assert.equal(body.ok, true);

  const p = body.progress;
  // The exact response the incident produced, which must never come back:
  //   currentChapter 1 / progressVersion 0 / lastSavedAt null / [2,3,4]
  assert.deepEqual(
    {
      currentChapter: p.currentChapter,
      lastValidChapter: p.lastValidChapter,
      progressVersion: p.progressVersion,
      lastSavedAt: p.lastSavedAt,
      completedChapters: p.completedChapters,
    },
    {
      currentChapter: 5,
      lastValidChapter: 4,
      progressVersion: 46,
      lastSavedAt: "2026-08-20T18:52:26.696Z",
      completedChapters: [1, 2, 3, 4],
    },
  );
});

test("GET marks chapter 1 complete from a row field, not just from counts", async () => {
  // Chapters 2/3/4 derive from `.count`, a real envelope field, so they were
  // correct even while the code read rows off the envelope. Chapter 1 is the
  // only one sourced from row data — its absence was the fingerprint.
  const tables = productionFixture();
  tables.ownership_entities = [];
  tables.deal_documents = [];
  db = makeDb(tables);
  sessionDealId = DEAL;

  const { body } = await getJson();
  assert.deepEqual(
    body.progress.completedChapters,
    [1],
    "use_of_proceeds lives on the row; reading it off the envelope yields undefined",
  );
});

test("GET does not rewind the borrower under the client's clamp", async () => {
  // StartConciergeClient resolves position as
  //   Math.min(currentChapter, completedChapters.length + 1)
  // so a completion set short by one silently sends them back a chapter.
  db = makeDb(productionFixture());
  sessionDealId = DEAL;

  const { body } = await getJson();
  const p = body.progress;
  const resolved = Math.min(p.currentChapter ?? 1, (p.completedChapters ?? []).length + 1);
  assert.equal(resolved, 5, `client clamp resolved to chapter ${resolved}, expected 5`);
});

test("GET reports the resolved dealId", async () => {
  db = makeDb(productionFixture());
  sessionDealId = DEAL;

  const { body } = await getJson();
  assert.equal(body.dealId, DEAL, "the bound deal must be visible without a server-log round trip");
});

test("GET fails closed when the progress row cannot be read", async () => {
  // A failed read must never be reported as "no progress, start at chapter 1"
  // — to the borrower that is indistinguishable from deleted work.
  db = makeDb(productionFixture(), {
    failOn: (table, op) =>
      table === "borrower_intake_progress" && op === "select"
        ? { message: "canceling statement due to statement timeout" }
        : null,
  });
  sessionDealId = DEAL;

  const { status, body } = await getJson();
  assert.equal(status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.error, "progress_load_failed");
  assert.equal(body.dealId, DEAL);
  assert.equal(body.progress, undefined, "must not hand back a fabricated position");
});

test("GET floors the completion set when a completion read fails", async () => {
  // A failed count does not mean the chapter is incomplete, only that we
  // could not check — and shrinking the set rewinds the borrower.
  db = makeDb(productionFixture(), {
    failOn: (table) =>
      table === "deal_documents" ? { message: "permission denied" } : null,
  });
  sessionDealId = DEAL;

  const { body } = await getJson();
  const p = body.progress;
  assert.deepEqual(p.completedChapters, [1, 2, 3, 4], "last_valid_chapter=4 is the floor");
  assert.deepEqual(p.degraded, ["deal_documents"], "the failed read must be named");
  const resolved = Math.min(p.currentChapter, p.completedChapters.length + 1);
  assert.equal(resolved, 5, "a degraded read must not rewind the borrower");
});

test("GET omits facts rather than emptying them when hydration fails", async () => {
  // The client does setPurposes(p.facts.purposes ?? []), so returning a
  // well-formed empty facts object after a failed read wipes the borrower's
  // answers out of local state.
  db = makeDb(productionFixture(), {
    failOn: (table, op) =>
      table === "borrower_concierge_sessions" && op === "select"
        ? { message: "read failed" }
        : null,
  });
  sessionDealId = DEAL;

  const { body } = await getJson();
  assert.equal(body.ok, true);
  assert.equal(body.progress.facts, undefined, "absent, not blank");
});

test("GET returns a clean first-run shape when there is genuinely no progress", async () => {
  const tables = productionFixture();
  tables.borrower_intake_progress = [];
  tables.borrower_concierge_sessions = [];
  tables.ownership_entities = [];
  tables.deal_documents = [];
  db = makeDb(tables);
  sessionDealId = DEAL;

  const { body } = await getJson();
  assert.equal(body.ok, true);
  assert.equal(body.progress.currentChapter, 1);
  assert.equal(body.progress.progressVersion, 0);
  assert.equal(body.progress.lastSavedAt, null);
  assert.deepEqual(body.progress.completedChapters, []);
  assert.ok(body.progress.facts, "a successful empty read still returns facts");
});

test("GET returns 401 without a session", async () => {
  db = makeDb(productionFixture());
  sessionDealId = null;

  const { status, body } = await getJson();
  assert.equal(status, 401);
  assert.equal(body.error, "no_session");
});

// ── POST ────────────────────────────────────────────────────────────────

function mkReq(body: unknown): any {
  return { json: async () => body };
}

test("POST advances the version from the persisted one", async () => {
  const tables = productionFixture();
  db = makeDb(tables);
  sessionDealId = DEAL;

  const res = await POST(mkReq({ chapter: 5, data: {} }));
  const body = (await res.json()) as any;

  assert.equal(body.ok, true);
  assert.equal(body.progress.progressVersion, 47, "version must continue from 46, not restart");
  assert.equal(tables.borrower_intake_progress[0].current_chapter, 5);
});

test("POST never regresses last_valid_chapter on a degraded read", async () => {
  // The stored pointer says chapter 4 was reached. A failed completion read
  // must not lower it — that is the same "unknown treated as absent" bug.
  const tables = productionFixture();
  db = makeDb(tables, {
    failOn: (table) =>
      table === "ownership_entities" || table === "deal_documents"
        ? { message: "permission denied" }
        : null,
  });
  sessionDealId = DEAL;

  const res = await POST(mkReq({ chapter: 5, data: {} }));
  const body = (await res.json()) as any;

  assert.equal(body.ok, true);
  assert.equal(body.progress.lastValidChapter, 4, "must hold at the persisted 4");
  assert.equal(tables.borrower_intake_progress[0].last_valid_chapter, 4);
});

test("POST rejects an out-of-range chapter", async () => {
  db = makeDb(productionFixture());
  sessionDealId = DEAL;

  for (const chapter of [0, 6, -1]) {
    const res = await POST(mkReq({ chapter, data: {} }));
    assert.equal(res.status, 400, `chapter ${chapter} must be rejected`);
  }
});
