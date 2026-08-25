import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

/**
 * Owner edit/delete + the 100% invariant.
 *
 * Deal b296dec2 carried three owners totalling 149% — "Sebrina Colon" 51%,
 * "Matthew Paller" 49%, and a typo duplicate "matt paller" 49% created two
 * days later. All three cleared the 20% threshold, so the sealing gate
 * demanded three identity verifications for a two-person business and
 * could never be satisfied. propagateBorrowerFacts inserts an owner for
 * any unseen normalized name and never removes a dropped one, and the
 * borrower had no edit or delete control anywhere in the product.
 */

const DEAL = "b296dec2-66c6-4946-8ddc-850daa7f968f";

type Row = Record<string, any>;
const db: { owners: Row[]; verifications: Row[]; events: Row[] } = {
  owners: [], verifications: [], events: [],
};

function q(table: string) {
  const filters: Array<{ k: string; v: any; kind: "eq" | "in" }> = [];
  let update: Row | null = null;
  let deleting = false;

  const store = () =>
    table === "ownership_entities" ? db.owners
      : table === "borrower_identity_verifications" ? db.verifications
        : db.events;

  const rows = () => {
    let out = [...store()];
    for (const f of filters) {
      if (f.kind === "eq") out = out.filter((r) => r[f.k] === f.v);
      else out = out.filter((r) => (f.v as any[]).includes(r[f.k]));
    }
    return out;
  };

  const apply = () => {
    if (update) for (const r of rows()) Object.assign(r, update);
    if (deleting) {
      const doomed = new Set(rows());
      const s = store();
      for (let i = s.length - 1; i >= 0; i--) if (doomed.has(s[i])) s.splice(i, 1);
    }
  };

  const builder: any = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (k: string, v: any) => { filters.push({ k, v, kind: "eq" }); return builder; },
    in: (k: string, v: any[]) => { filters.push({ k, v, kind: "in" }); return builder; },
    update: (u: Row) => { update = u; return builder; },
    delete: () => { deleting = true; return builder; },
    insert: (p: Row) => { if (table === "deal_events") db.events.push(p); return builder; },
    maybeSingle: async () => { const r = rows()[0] ?? null; apply(); return { data: r, error: null }; },
    single: async () => { const r = rows()[0] ?? null; apply(); return { data: r, error: null }; },
    then: (res: any, rej?: any) => { const r = rows(); apply(); return Promise.resolve({ data: r, error: null }).then(res, rej); },
  };
  return builder;
}

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "sb", filename: "sb", loaded: true, exports: { supabaseAdmin: () => ({ from: q }) },
} as any;

require.cache[require.resolve("@/lib/borrower/resolvePortalContext")] = {
  id: "ctx", filename: "ctx", loaded: true,
  exports: { resolvePortalContext: async () => ({ dealId: DEAL, bankId: "bank1" }) },
} as any;

const { GET, PATCH, DELETE } = require("../route") as typeof import("../route");

function ctx() { return { params: Promise.resolve({ token: DEAL }) }; }
function req(body: unknown): any { return { json: async () => body }; }

function seed149() {
  db.owners = [
    { id: "o-sebrina", deal_id: DEAL, display_name: "Sebrina Colon", ownership_pct: 51 },
    { id: "o-matthew", deal_id: DEAL, display_name: "Matthew Paller", ownership_pct: 49 },
    { id: "o-typo", deal_id: DEAL, display_name: "matt paller", ownership_pct: 49 },
  ];
  db.verifications = [];
  db.events = [];
}

test("GET reports the real total, flags it as over 100%, and names the duplicate", async () => {
  seed149();
  const res = await GET({} as any, ctx() as any);
  const body = (await res.json()) as any;

  assert.equal(body.summary.total, 149);
  assert.equal(body.summary.valid, false);
  assert.equal(body.summary.problem, "over");
  assert.equal(body.summary.ownersRequiringVerification, 3);
  assert.ok(body.owners.every((o: any) => o.requiresVerification));
});

test("deleting the typo duplicate brings the deal back to a sealable 100%", async () => {
  seed149();
  const res = await DELETE(req({ ownerId: "o-typo" }) as any, ctx() as any);
  const body = (await res.json()) as any;

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.summary.total, 100);
  assert.equal(body.summary.valid, true);
  assert.equal(body.summary.ownersRequiringVerification, 2);
  assert.equal(db.owners.length, 2);
  assert.ok(db.events.some((e) => e.kind === "ownership.owner_removed"));
});

test("an owner who already verified cannot be deleted — that would discard a completed IAL2 record", async () => {
  seed149();
  db.verifications = [
    { id: "v1", deal_id: DEAL, ownership_entity_id: "o-sebrina", status: "approved", completed_at: "2026-08-25" },
  ];

  const res = await DELETE(req({ ownerId: "o-sebrina" }) as any, ctx() as any);
  const body = (await res.json()) as any;

  assert.equal(res.status, 409);
  assert.equal(body.error, "OWNER_VERIFIED");
  assert.ok(typeof body.message === "string" && body.message.length > 0);
  assert.equal(db.owners.length, 3, "the owner must still be there");
});

test("deleting an unverified owner clears their abandoned verification attempts", async () => {
  seed149();
  db.verifications = [
    { id: "v-abandoned", deal_id: DEAL, ownership_entity_id: "o-typo", status: "created", completed_at: null },
  ];

  await DELETE(req({ ownerId: "o-typo" }) as any, ctx() as any);

  assert.equal(
    db.verifications.filter((v) => v.ownership_entity_id === "o-typo").length,
    0,
    "no orphan verification row may point at a deleted owner",
  );
});

test("PATCH can correct a percentage, and the new total is reported back", async () => {
  seed149();
  const res = await PATCH(req({ ownerId: "o-typo", ownershipPct: 1, displayName: "matt paller" }) as any, ctx() as any);
  const body = (await res.json()) as any;

  assert.equal(res.status, 200);
  assert.equal(body.summary.total, 101);
  assert.equal(body.summary.valid, false);
  assert.equal(db.owners.find((o) => o.id === "o-typo")!.ownership_pct, 1);
});

test("PATCH rejects a blank name and an out-of-range percentage", async () => {
  seed149();

  const blank = await PATCH(req({ ownerId: "o-typo", displayName: "   " }) as any, ctx() as any);
  assert.equal(blank.status, 422);
  assert.equal((await blank.json() as any).error, "INVALID_NAME");

  for (const pct of [0, -5, 101, "abc"]) {
    const res = await PATCH(req({ ownerId: "o-typo", ownershipPct: pct }) as any, ctx() as any);
    assert.equal(res.status, 422, `ownershipPct=${pct} must be rejected`);
    assert.equal((await res.json() as any).error, "INVALID_PCT");
  }

  assert.equal(db.owners.find((o) => o.id === "o-typo")!.ownership_pct, 49, "nothing may be written on a rejected patch");
});

test("a portal token cannot touch an owner on another deal", async () => {
  seed149();
  db.owners.push({ id: "o-other", deal_id: "some-other-deal", display_name: "Someone Else", ownership_pct: 100 });

  const patched = await PATCH(req({ ownerId: "o-other", ownershipPct: 5 }) as any, ctx() as any);
  assert.equal(patched.status, 404);

  const deleted = await DELETE(req({ ownerId: "o-other" }) as any, ctx() as any);
  assert.equal(deleted.status, 404);

  assert.equal(db.owners.find((o) => o.id === "o-other")!.ownership_pct, 100);
});

test("a valid 100% list reports itself as valid with no problem", async () => {
  db.owners = [
    { id: "o-a", deal_id: DEAL, display_name: "A", ownership_pct: 60 },
    { id: "o-b", deal_id: DEAL, display_name: "B", ownership_pct: 40 },
  ];
  db.verifications = []; db.events = [];

  const body = (await (await GET({} as any, ctx() as any)).json()) as any;
  assert.equal(body.summary.valid, true);
  assert.equal(body.summary.problem, null);
  assert.deepEqual(body.summary.duplicateNames, []);
});
