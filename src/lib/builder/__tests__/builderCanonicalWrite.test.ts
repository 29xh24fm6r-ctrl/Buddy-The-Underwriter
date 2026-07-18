import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { PartiesSectionData } from "@/lib/builder/builderTypes";

let writeBuilderCanonical: typeof import("@/lib/builder/builderCanonicalWrite").writeBuilderCanonical;

before(async () => {
  mockServerOnly(); // builderCanonicalWrite imports "server-only"
  ({ writeBuilderCanonical } = await import("@/lib/builder/builderCanonicalWrite"));
});

/**
 * Minimal fake Supabase client covering exactly the ownership_entities
 * select/insert/update chains writePartiesCanonical uses. In-memory table
 * keyed by id, seeded by test setup.
 */
function makeFakeSb(seed: Array<Record<string, any>> = []) {
  const rows = new Map<string, Record<string, any>>(seed.map((r) => [r.id, { ...r }]));
  let nextId = 1;
  const updateCalls: Array<{ id: string; patch: Record<string, any> }> = [];

  const client = {
    from(table: string) {
      assert.equal(table, "ownership_entities");
      return {
        select() {
          return {
            eq(_c1: string, dealId: string) {
              return {
                eq(_c2: string, displayName: string) {
                  return {
                    maybeSingle: async () => {
                      const found = [...rows.values()].find((r) => r.deal_id === dealId && r.display_name === displayName);
                      return { data: found ? { id: found.id } : null };
                    },
                  };
                },
              };
            },
          };
        },
        insert(row: Record<string, any>) {
          return {
            select() {
              return {
                maybeSingle: async () => {
                  const id = `new-${nextId++}`;
                  rows.set(id, { id, ...row });
                  return { data: { id } };
                },
              };
            },
          };
        },
        update(patch: Record<string, any>) {
          return {
            eq: async (_c: string, id: string) => {
              updateCalls.push({ id, patch });
              const existing = rows.get(id) ?? { id };
              rows.set(id, { ...existing, ...patch });
              return { error: null };
            },
          };
        },
      };
    },
  };

  return { client, rows, updateCalls };
}

test("writePartiesCanonical: new owner -> creates row and syncs all fields", async () => {
  const { client, rows } = makeFakeSb();
  const data: Partial<PartiesSectionData> = {
    owners: [
      {
        id: "draft-1",
        full_legal_name: "Jane Doe",
        title: "Managing Member",
        ownership_pct: 60,
        dob: "1980-01-01",
        ssn_last4: "1234",
        home_address: "1 Main St",
        home_city: "Austin",
        home_state: "TX",
        home_zip: "78701",
      },
    ],
  };

  const result = await writeBuilderCanonical("deal-1", "parties", data as Record<string, unknown>, client as any);

  assert.equal(result.ownerEntityIds?.length, 1);
  const { ownership_entity_id } = result.ownerEntityIds![0];
  assert.equal(result.ownerEntityIds![0].id, "draft-1");

  const row = rows.get(ownership_entity_id);
  assert.equal(row?.title, "Managing Member");
  assert.equal(row?.ownership_pct, 60);
  assert.equal(row?.date_of_birth, "1980-01-01");
  assert.equal(row?.tax_id_last4, "1234");
  assert.equal(row?.home_address_street, "1 Main St");
  assert.equal(row?.home_address_city, "Austin");
  assert.equal(row?.home_address_state, "TX");
  assert.equal(row?.home_address_zip, "78701");
});

test("writePartiesCanonical: existing owner, partial edit -> only provided fields overwritten", async () => {
  const { client, rows } = makeFakeSb([
    {
      id: "existing-1",
      deal_id: "deal-1",
      display_name: "Jane Doe",
      title: "CEO",
      ownership_pct: 50,
      date_of_birth: "1975-05-05",
      home_address_street: "9 Old Rd",
    },
  ]);

  // Owner form only carries title (e.g. the banker only edited the title
  // field) — ownership_pct/dob/address are undefined on this draft, not
  // null, so they must NOT be overwritten.
  const data: Partial<PartiesSectionData> = {
    owners: [{ id: "draft-1", full_legal_name: "Jane Doe", title: "President" }],
  };

  const result = await writeBuilderCanonical("deal-1", "parties", data as Record<string, unknown>, client as any);

  assert.equal(result.ownerEntityIds?.[0]?.ownership_entity_id, "existing-1");
  const row = rows.get("existing-1");
  assert.equal(row?.title, "President");
  assert.equal(row?.ownership_pct, 50, "untouched field must survive");
  assert.equal(row?.date_of_birth, "1975-05-05", "untouched field must survive");
  assert.equal(row?.home_address_street, "9 Old Rd", "untouched field must survive");
});

test("writePartiesCanonical: owner with no full_legal_name is skipped", async () => {
  const { client } = makeFakeSb();
  const data: Partial<PartiesSectionData> = { owners: [{ id: "draft-1" }] };
  const result = await writeBuilderCanonical("deal-1", "parties", data as Record<string, unknown>, client as any);
  assert.deepEqual(result.ownerEntityIds, []);
});

test("writeBuilderCanonical: non-parties sections return no ownerEntityIds", async () => {
  const { client } = makeFakeSb();
  const result = await writeBuilderCanonical("deal-1", "story", {}, client as any);
  assert.deepEqual(result, {});
});

/**
 * Minimal fake Supabase client covering exactly the deals select/update
 * chain writeBusinessCanonical/writeOperatingCompanyCanonical use.
 * In-memory single deal row keyed by id, seeded by test setup.
 */
function makeFakeDealsSb(seed: Record<string, any> = {}) {
  const deal: Record<string, any> = { id: "deal-1", ...seed };
  const updateCalls: Array<Record<string, any>> = [];

  const client = {
    from(table: string) {
      assert.equal(table, "deals");
      return {
        select() {
          return {
            eq: () => ({
              maybeSingle: async () => ({ data: { ...deal } }),
            }),
          };
        },
        update(patch: Record<string, any>) {
          return {
            eq: async () => {
              updateCalls.push(patch);
              Object.assign(deal, patch);
              return { error: null };
            },
          };
        },
      };
    },
  };

  return { client, deal, updateCalls };
}

test("writeBusinessCanonical: is_eligible_passive_company + operating_company_* fields sync to deals", async () => {
  const { client, deal } = makeFakeDealsSb({ name: "Acme Manufacturing LLC" });
  await writeBuilderCanonical(
    "deal-1",
    "business",
    {
      is_eligible_passive_company: true,
      operating_company_legal_name: "Acme Real Estate Holdings LLC",
      operating_company_tax_id: "98-7654321",
    },
    client as any,
  );

  assert.equal(deal.is_eligible_passive_company, true);
  assert.equal(deal.operating_company_legal_name, "Acme Real Estate Holdings LLC");
  assert.equal(deal.operating_company_tax_id, "98-7654321");
});

test("writeBusinessCanonical: unprovided operating_company_* fields don't trigger an update", async () => {
  const { client, updateCalls } = makeFakeDealsSb({ name: "Acme Manufacturing LLC" });
  await writeBuilderCanonical("deal-1", "business", { entity_type: "LLC" }, client as any);
  assert.equal(updateCalls.length, 0, "no operating-company keys present -> no deals update at all");
});

test("writeBusinessCanonical: legal_entity_name only fills deals.name when currently empty", async () => {
  const { client, deal } = makeFakeDealsSb({ name: "Existing Name" });
  await writeBuilderCanonical("deal-1", "business", { legal_entity_name: "New Name" }, client as any);
  assert.equal(deal.name, "Existing Name", "must not overwrite an existing deals.name");
});
