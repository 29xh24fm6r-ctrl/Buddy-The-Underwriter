import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

/**
 * Regression suite for "borrower returns from Didit with nothing to do".
 *
 * On 2026-08-25 borrower_identity_verifications held exactly one row for
 * deal b296dec2 — status "created", completed_at NULL — while the Didit
 * session was `Approved`. The completion webhook was never delivered
 * (Didit's own destination metrics showed zero delivery attempts ever),
 * and no polling, return-URL reconcile, or cron existed to notice. The
 * panel rendered that row as "Started" plus a link back to the finished
 * session: a state with no exit.
 *
 * These tests pin the two properties that make that state unreachable:
 *   1. GET reconciles against the vendor before answering.
 *   2. Every owner who is not verified is returned with at least one
 *      available action.
 */

const DEAL = "b296dec2-66c6-4946-8ddc-850daa7f968f";
const OWNER = "e4a02887-bf93-4efa-835c-d7d41b80f09d";
const SESSION = "252f29e1-5d22-4743-a44d-71042bcd0389";

type Row = Record<string, any>;

const db: { owners: Row[]; verifications: Row[]; events: Row[] } = {
  owners: [],
  verifications: [],
  events: [],
};

let vendorStatus = "Approved";
let vendorThrows: Error | null = null;
let fetchCalls = 0;

function q(table: string) {
  const filters: Array<{ k: string; v: any; kind: "eq" | "in" | "notnull" }> = [];
  let update: Row | null = null;

  const rows = () => {
    let out =
      table === "ownership_entities"
        ? [...db.owners]
        : table === "borrower_identity_verifications"
          ? [...db.verifications]
          : [...db.events];
    for (const f of filters) {
      if (f.kind === "eq") out = out.filter((r) => r[f.k] === f.v);
      else if (f.kind === "in") out = out.filter((r) => (f.v as any[]).includes(r[f.k]));
      else out = out.filter((r) => r[f.k] != null);
    }
    return out;
  };

  const apply = () => {
    if (update) for (const r of rows()) Object.assign(r, update);
  };

  const builder: any = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (k: string, v: any) => { filters.push({ k, v, kind: "eq" }); return builder; },
    in: (k: string, v: any[]) => { filters.push({ k, v, kind: "in" }); return builder; },
    not: (k: string) => { filters.push({ k, v: null, kind: "notnull" }); return builder; },
    update: (u: Row) => { update = u; return builder; },
    insert: (p: Row) => { if (table === "deal_events") db.events.push(p); return builder; },
    maybeSingle: async () => { apply(); return { data: rows()[0] ?? null, error: null }; },
    single: async () => { apply(); return { data: rows()[0] ?? null, error: null }; },
    then: (res: any, rej?: any) => { apply(); return Promise.resolve({ data: rows(), error: null }).then(res, rej); },
  };
  return builder;
}

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "sb", filename: "sb", loaded: true,
  exports: { supabaseAdmin: () => ({ from: q }) },
} as any;

require.cache[require.resolve("@/lib/borrower/resolvePortalContext")] = {
  id: "ctx", filename: "ctx", loaded: true,
  exports: { resolvePortalContext: async () => ({ dealId: DEAL, bankId: "bank1" }) },
} as any;

require.cache[require.resolve("@/lib/identity/kyc/didit")] = {
  id: "didit", filename: "didit", loaded: true,
  exports: {
    createDiditSession: async () => ({ session_id: "new", status: "Not Started", url: "https://verify.didit.me/s/new" }),
    fetchDiditSession: async (id: string) => {
      fetchCalls++;
      if (vendorThrows) throw vendorThrows;
      return { session_id: id, status: vendorStatus, workflow_id: "w", url: "https://verify.didit.me/session/MERgh9gj5q4G" };
    },
    getDiditSessionDecision: async (id: string) => ({ session_id: id, status: vendorStatus }),
  },
} as any;

const { GET, POST } = require("../route") as typeof import("../route");

function ctx() {
  return { params: Promise.resolve({ token: DEAL }) };
}

function seedProductionState() {
  db.owners = [{ id: OWNER, deal_id: DEAL, display_name: "Sebrina Colon", ownership_pct: 51 }];
  db.verifications = [
    {
      id: "8dfa3d32-24a3-4d7a-9a14-3b86ab868687",
      deal_id: DEAL,
      ownership_entity_id: OWNER,
      vendor: "didit",
      vendor_inquiry_id: SESSION,
      vendor_artifacts_url: "https://verify.didit.me/session/MERgh9gj5q4G",
      status: "created",
      completed_at: null,
      created_at: "2026-08-25T15:36:35Z",
    },
  ];
  db.events = [];
  fetchCalls = 0;
  vendorThrows = null;
}

test("GET reconciles the stranded production row instead of echoing 'created'", async () => {
  seedProductionState();
  vendorStatus = "Approved";

  const res = await GET({} as any, ctx() as any);
  const body = (await res.json()) as any;

  assert.equal(body.ok, true);
  assert.ok(fetchCalls > 0, "GET must ask the vendor, not just read our own stale row");

  const owner = body.owners[0];
  assert.equal(owner.verification.status, "approved", "the borrower must see their real status");
  assert.equal(owner.verified, true);
  assert.ok(owner.verification.completedAt, "completed_at must be stamped so the seal gate opens");
  assert.equal(body.allVerified, true);
});

test("an owner who is genuinely not finished still has at least one action", async () => {
  seedProductionState();
  vendorStatus = "In Progress";

  const res = await GET({} as any, ctx() as any);
  const body = (await res.json()) as any;
  const owner = body.owners[0];

  assert.equal(owner.verified, false);
  const actions = owner.actions;
  assert.ok(
    actions.canStart || actions.canResume || actions.canRefresh,
    "a non-verified owner with zero available actions is the dead end this fixes",
  );
  assert.equal(actions.canRefresh, true, "Refresh status must always be reachable once a verification exists");
});

test("every non-verified status leaves at least one action available", async () => {
  for (const status of ["Not Started", "In Progress", "In Review", "Declined", "Expired", "Abandoned"]) {
    seedProductionState();
    vendorStatus = status;

    const res = await GET({} as any, ctx() as any);
    const body = (await res.json()) as any;
    const owner = body.owners[0];

    assert.equal(owner.verified, false, `${status} must not read as verified`);
    assert.ok(
      owner.actions.canStart || owner.actions.canResume || owner.actions.canRefresh,
      `${status} left the borrower with no available action`,
    );
  }
});

test("an owner with no verification at all can start one", async () => {
  seedProductionState();
  db.verifications = [];

  const res = await GET({} as any, ctx() as any);
  const body = (await res.json()) as any;
  const owner = body.owners[0];

  assert.equal(owner.verification, null);
  assert.equal(owner.actions.canStart, true);
});

test("GET reports a broken ownership total so a 149% deal explains itself", async () => {
  seedProductionState();
  vendorStatus = "Approved";
  db.owners = [
    { id: OWNER, deal_id: DEAL, display_name: "Sebrina Colon", ownership_pct: 51 },
    { id: "791f44da", deal_id: DEAL, display_name: "Matthew Paller", ownership_pct: 49 },
    { id: "6a73cd59", deal_id: DEAL, display_name: "matt paller", ownership_pct: 49 },
  ];

  const res = await GET({} as any, ctx() as any);
  const body = (await res.json()) as any;

  assert.equal(body.ownership.total, 149);
  assert.equal(body.ownership.valid, false);
  assert.equal(body.ownership.ownerCount, 3);
  assert.equal(body.owners.length, 3, "all three are over the 20% threshold, so all three gate the seal");
});

test("POST action=refresh reconciles one owner on demand", async () => {
  seedProductionState();
  vendorStatus = "Approved";

  const res = await POST(
    { json: async () => ({ ownershipEntityId: OWNER, action: "refresh" }), headers: { get: () => null } } as any,
    ctx() as any,
  );
  const body = (await res.json()) as any;

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, "approved");
  assert.equal(body.changed, true);
  assert.equal(db.verifications[0].status, "approved");
});

test("POST action=refresh reports a vendor outage instead of failing silently", async () => {
  seedProductionState();

  vendorThrows = new Error("Didit API /session/ failed: 503");

  const res = await POST(
    { json: async () => ({ ownershipEntityId: OWNER, action: "refresh" }), headers: { get: () => null } } as any,
    ctx() as any,
  );
  const body = (await res.json()) as any;

  assert.equal(res.status, 502);
  assert.equal(body.ok, false);
  assert.ok(typeof body.message === "string" && body.message.length > 0);
  assert.equal(db.verifications[0].status, "created", "a failed refresh must not invent a status");
});
