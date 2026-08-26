import { test } from "node:test";
import assert from "node:assert/strict";
import { ownersNeedingIal2 } from "@/lib/brokerage/identityVerificationGate";

type Owner = { id: string; display_name: string | null; ownership_pct: number };

function makeSb(owners: Owner[], verifiedOwnerIds: Set<string>) {
  return {
    from(table: string) {
      const q: any = {
        _filters: {} as Record<string, any>,
        select() {
          return this;
        },
        eq(k: string, v: any) {
          this._filters[k] = v;
          return this;
        },
        in(k: string, v: any[]) {
          this._filters[k] = { in: v };
          return this;
        },
        not() {
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
            const verified = verifiedOwnerIds.has(ownerId);
            return Promise.resolve({
              data: verified ? { id: `verification-${ownerId}`, completed_at: new Date().toISOString() } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (r: { data: any; error: null }) => void) {
          if (table === "ownership_entities") {
            resolve({ data: owners, error: null });
            return;
          }
          if (table === "borrower_identity_verifications") {
            const requested = new Set(this._filters["ownership_entity_id"]?.in ?? []);
            const data = Array.from(verifiedOwnerIds)
              .filter((ownerId) => requested.has(ownerId))
              .map((ownerId) => ({ ownership_entity_id: ownerId }));
            resolve({ data, error: null });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return q;
    },
  } as any;
}

test("ownersNeedingIal2: no owners -> empty", async () => {
  const result = await ownersNeedingIal2("deal-1", makeSb([], new Set()));
  assert.deepEqual(result, []);
});

test("ownersNeedingIal2: owner below 20% is excluded", async () => {
  const owners: Owner[] = [{ id: "owner-1", display_name: "Minor Owner", ownership_pct: 15 }];
  const result = await ownersNeedingIal2("deal-1", makeSb(owners, new Set()));
  assert.deepEqual(result, []);
});

test("ownersNeedingIal2: owner at exactly 20% with no verification is flagged", async () => {
  const owners: Owner[] = [{ id: "owner-1", display_name: "Threshold Owner", ownership_pct: 20 }];
  const result = await ownersNeedingIal2("deal-1", makeSb(owners, new Set()));
  assert.deepEqual(result, [{ id: "owner-1", display_name: "Threshold Owner" }]);
});

test("ownersNeedingIal2: verified majority owner is excluded", async () => {
  const owners: Owner[] = [{ id: "owner-1", display_name: "Verified Owner", ownership_pct: 100 }];
  const result = await ownersNeedingIal2("deal-1", makeSb(owners, new Set(["owner-1"])));
  assert.deepEqual(result, []);
});

test("ownersNeedingIal2: mixed roster only flags unverified majority owners", async () => {
  const owners: Owner[] = [
    { id: "owner-verified", display_name: "Verified", ownership_pct: 60 },
    { id: "owner-unverified", display_name: "Unverified", ownership_pct: 40 },
    { id: "owner-minor", display_name: "Minor", ownership_pct: 5 },
  ];
  const result = await ownersNeedingIal2("deal-1", makeSb(owners, new Set(["owner-verified"])));
  assert.deepEqual(result, [{ id: "owner-unverified", display_name: "Unverified" }]);
});


test("ownersNeedingIal2: uses two set-based queries regardless of owner count", async () => {
  const owners: Owner[] = [
    { id: "owner-a", display_name: "Owner A", ownership_pct: 40 },
    { id: "owner-b", display_name: "Owner B", ownership_pct: 35 },
    { id: "owner-c", display_name: "Owner C", ownership_pct: 25 },
  ];
  const base = makeSb(owners, new Set(["owner-a", "owner-c"]));
  let queryCount = 0;
  const sb = {
    from(table: string) {
      queryCount += 1;
      return base.from(table);
    },
  } as any;

  const result = await ownersNeedingIal2("deal-1", sb);

  assert.equal(queryCount, 2, "owner roster and identity evidence should each use one query");
  assert.deepEqual(result, [{ id: "owner-b", display_name: "Owner B" }]);
});
