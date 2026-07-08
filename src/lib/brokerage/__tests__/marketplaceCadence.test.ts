/**
 * SPEC brokerage-online — marketplace cadence engine + surface wiring.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { advanceMarketplaceListings } from "../marketplaceCadence";

// ── Minimal in-memory Supabase stub (predicate-accumulating query builder) ──
function makeSb(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = seed;
  function from(table: string) {
    if (!tables[table]) tables[table] = [];
    const preds: ((r: any) => boolean)[] = [];
    let op: "select" | "update" | "insert" = "select";
    let payload: any = null;
    const matched = () => tables[table].filter((r) => preds.every((p) => p(r)));
    async function resolve() {
      if (op === "update") {
        const m = matched();
        m.forEach((r) => Object.assign(r, payload));
        return { data: m.map((r) => ({ ...r })), error: null };
      }
      if (op === "insert") {
        const row = { id: `id-${tables[table].length + 1}`, ...payload };
        tables[table].push(row);
        return { data: { ...row }, error: null };
      }
      return { data: matched(), error: null };
    }
    const api: any = {
      select: () => api,
      order: () => api,
      limit: () => api,
      contains: () => api,
      eq: (c: string, v: any) => (preds.push((r) => r[c] === v), api),
      neq: (c: string, v: any) => (preds.push((r) => r[c] !== v), api),
      lte: (c: string, v: any) => (preds.push((r) => r[c] != null && r[c] <= v), api),
      gt: (c: string, v: any) => (preds.push((r) => r[c] != null && r[c] > v), api),
      in: (c: string, vs: any[]) => (preds.push((r) => vs.includes(r[c])), api),
      is: (c: string, v: any) => (preds.push((r) => (v === null ? r[c] == null : r[c] === v)), api),
      update: (p: any) => ((op = "update"), (payload = p), api),
      insert: (p: any) => ((op = "insert"), (payload = p), api),
      maybeSingle: async () => {
        const r = await resolve();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
      },
      single: async () => {
        const r = await resolve();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
      },
      then: (res: any, rej: any) => resolve().then(res, rej),
    };
    return api;
  }
  return { from, _tables: tables };
}

const T0 = "2026-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

describe("advanceMarketplaceListings", () => {
  it("opens the claim window: pending_preview → claiming when claim_opens_at has passed", async () => {
    const sb = makeSb({
      marketplace_listings: [
        { id: "L1", deal_id: "D1", status: "pending_preview", claim_opens_at: PAST, claim_closes_at: FUTURE, matched_lender_bank_ids: [], picked_at: null },
      ],
    });
    const r = await advanceMarketplaceListings(sb as any, new Date(T0));
    assert.equal(r.opened, 1);
    assert.equal(sb._tables.marketplace_listings[0].status, "claiming");
  });

  it("does NOT open a listing whose claim window is still in the future", async () => {
    const sb = makeSb({
      marketplace_listings: [
        { id: "L1", deal_id: "D1", status: "pending_preview", claim_opens_at: FUTURE, claim_closes_at: FUTURE, matched_lender_bank_ids: [], picked_at: null },
      ],
    });
    const r = await advanceMarketplaceListings(sb as any, new Date(T0));
    assert.equal(r.opened, 0);
    assert.equal(sb._tables.marketplace_listings[0].status, "pending_preview");
  });

  it("expires an un-picked listing whose claim window has closed", async () => {
    const sb = makeSb({
      marketplace_listings: [
        { id: "L1", deal_id: "D1", status: "claiming", claim_opens_at: PAST, claim_closes_at: PAST, matched_lender_bank_ids: [], picked_at: null },
      ],
    });
    const r = await advanceMarketplaceListings(sb as any, new Date(T0));
    assert.equal(r.expired, 1);
    assert.equal(sb._tables.marketplace_listings[0].status, "expired");
  });

  it("never expires a picked listing", async () => {
    const sb = makeSb({
      marketplace_listings: [
        { id: "L1", deal_id: "D1", status: "picked", claim_opens_at: PAST, claim_closes_at: PAST, matched_lender_bank_ids: [], picked_at: T0 },
      ],
    });
    const r = await advanceMarketplaceListings(sb as any, new Date(T0));
    assert.equal(r.expired, 0);
    assert.equal(sb._tables.marketplace_listings[0].status, "picked");
  });
});

describe("marketplace surface wiring", () => {
  const API = path.resolve(__dirname, "../../../app/api");
  const read = (rel: string) => fs.readFileSync(path.join(API, rel), "utf8");

  it("lender listings + claim + package routes resolve lender identity (fail closed)", () => {
    for (const rel of [
      "lender/marketplace/listings/route.ts",
      "lender/marketplace/listings/[listingId]/claim/route.ts",
      "lender/marketplace/package/[accessId]/route.ts",
    ]) {
      const src = read(rel);
      assert.ok(src.includes("resolveLenderIdentity"), `${rel} must gate on resolveLenderIdentity`);
      assert.ok(src.includes("not_a_lender"), `${rel} must 403 non-lenders`);
    }
  });

  it("claim route delegates to the claim_marketplace_listing RPC", () => {
    const src = read("lender/marketplace/listings/[listingId]/claim/route.ts");
    assert.ok(src.includes('rpc("claim_marketplace_listing"'));
  });

  it("borrower pick route is cookie-session-scoped and grants package access", () => {
    const src = read("brokerage/deals/[dealId]/marketplace/pick/route.ts");
    assert.ok(src.includes("getBorrowerSession"));
    assert.ok(src.includes("session.deal_id !== dealId"));
    assert.ok(src.includes("marketplace_package_access"));
  });

  it("marketplace cron is CRON_SECRET gated and runs cadence + lender comms", () => {
    const src = read("cron/brokerage/marketplace/run/route.ts");
    assert.ok(src.includes("verifyCronSecret"));
    assert.ok(src.includes("advanceMarketplaceListings"));
    assert.ok(src.includes("runLenderCommsCycle"));
  });
});
