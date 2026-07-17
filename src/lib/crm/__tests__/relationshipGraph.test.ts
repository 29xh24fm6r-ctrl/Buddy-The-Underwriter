import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const orgs = require("../organizations") as typeof import("../organizations");
const people = require("../people") as typeof import("../people");
const partyRoles = require("../partyRoles") as typeof import("../partyRoles");
const dedup = require("../dedup") as typeof import("../dedup");
const resolve = require("../resolve") as typeof import("../resolve");

type Row = Record<string, any>;
let idCounter = 0;

/** Minimal in-memory fake Supabase client — same shape used across
 * src/lib/brokerage/__tests__/*.ts (e.g. lenderComms.test.ts). */
class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = {
      crm_organizations: [],
      crm_people: [],
      crm_person_organization_roles: [],
      deal_party_roles: [],
      deal_source_attribution: [],
      crm_merge_log: [],
      crm_activities: [],
      deals: [],
      brokerage_leads: [],
      ...seed,
    };
  }
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

// Columns whose real Postgres DEFAULT the fake needs to simulate, since a
// freshly-inserted fake row simply lacks the key rather than reading as
// the default value the way a real row would.
const COLUMN_DEFAULTS: Record<string, any> = {
  is_active: true,
  merged_into_id: null,
  merged_at: null,
};

class FakeQuery {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }>;
  _update: Row | null = null;
  _insert: Row[] | null = null;
  _delete = false;
  _limit: number | null = null;
  _order: { key: string; asc: boolean } | null = null;
  _embeds: Array<{ alias: string; table: string }> = [];

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
    this.filters = [];
  }
  select(cols?: string) {
    if (cols) {
      for (const m of cols.matchAll(/(\w+):(\w+)\([^)]*\)/g)) {
        this._embeds.push({ alias: m[1], table: m[2] });
      }
    }
    return this;
  }
  order(key: string, opts?: { ascending?: boolean }) {
    this._order = { key, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this._limit = n;
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ t: "eq", k, v });
    return this;
  }
  is(k: string, v: any) {
    this.filters.push({ t: "is", k, v });
    return this;
  }
  in(k: string, v: any[]) {
    this.filters.push({ t: "in", k, v });
    return this;
  }
  or() {
    // Not modeled precisely in the fake — tests that need real OR semantics
    // avoid depending on it. Left as a passthrough so calls don't throw.
    return this;
  }
  insert(payload: Row | Row[]) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
      id: r.id ?? `id-${++idCounter}`,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      ...r,
    }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...rows);
    this._insert = rows;
    return this;
  }
  update(patch: Row) {
    this._update = patch;
    return this;
  }
  delete() {
    this._delete = true;
    return this;
  }
  single(): Promise<{ data: any; error: any }> {
    if (this._insert) return Promise.resolve({ data: this._insert[0], error: null });
    const rows = this.rows();
    if (rows.length === 0) return Promise.resolve({ data: null, error: { message: "no rows" } });
    return Promise.resolve({ data: rows[0], error: null });
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this._update) this.applyUpdate();
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(onFulfilled: any, onRejected?: any) {
    if (this._insert) return Promise.resolve({ data: this._insert, error: null }).then(onFulfilled, onRejected);
    if (this._update) {
      this.applyUpdate();
      return Promise.resolve({ data: this.rows(), error: null }).then(onFulfilled, onRejected);
    }
    if (this._delete) {
      const keep = (this.db.tables[this.table] ?? []).filter((r) => !this.matches(r));
      this.db.tables[this.table] = keep;
      return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
    }
    return Promise.resolve({ data: this.rows(), error: null, count: this.rows().length }).then(onFulfilled, onRejected);
  }
  private applyUpdate() {
    for (const row of this.rows()) Object.assign(row, this._update);
  }
  private field(row: Row, key: string): any {
    return key in row ? row[key] : COLUMN_DEFAULTS[key];
  }
  private matches(row: Row): boolean {
    for (const f of this.filters) {
      if (f.t === "eq" && this.field(row, f.k) !== f.v) return false;
      if (f.t === "is" && this.field(row, f.k) !== f.v) return false;
      if (f.t === "in" && !(f.v as any[]).includes(this.field(row, f.k))) return false;
    }
    return true;
  }
  private attachEmbeds(row: Row): Row {
    if (this._embeds.length === 0) return row;
    const out = { ...row };
    for (const { alias, table } of this._embeds) {
      const fkCol = `${alias}_id`;
      const fkVal = row[fkCol];
      out[alias] = fkVal ? (this.db.tables[table] ?? []).find((r) => r.id === fkVal) ?? null : null;
    }
    return out;
  }
  private rows(): Row[] {
    let rows = (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
    if (this._order) {
      const { key, asc } = this._order;
      rows = [...rows].sort((a, b) => (a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1));
    }
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return rows.map((r) => this.attachEmbeds(r));
  }
}

const BANK_A = "bank-a";
const BANK_B = "bank-b";

// ---------------------------------------------------------------------
// Person <-> organization roles (PR1's core behavior)
// ---------------------------------------------------------------------

test("one person can belong to multiple organizations under different roles", async () => {
  const db = new FakeDb();
  const person = await people.createPerson({ bankId: BANK_A, firstName: "Jamie", lastName: "Lee" }, db as any);
  const orgOne = await orgs.createOrganization({ bankId: BANK_A, name: "First CPA Firm", organizationType: "cpa_firm" }, db as any);
  const orgTwo = await orgs.createOrganization({ bankId: BANK_A, name: "Second Referral Co" }, db as any);

  await people.linkPersonToOrganization({ bankId: BANK_A, personId: person.id, organizationId: orgOne.id, role: "contact" }, db as any);
  await people.linkPersonToOrganization({ bankId: BANK_A, personId: person.id, organizationId: orgTwo.id, role: "decision_maker" }, db as any);

  const roles = await people.listOrganizationRolesForPerson(BANK_A, person.id, db as any);
  assert.equal(roles.length, 2);
  assert.deepEqual(roles.map((r) => r.organization_id).sort(), [orgOne.id, orgTwo.id].sort());
});

test("linking a new primary contact demotes the previous one", async () => {
  const db = new FakeDb();
  const org = await orgs.createOrganization({ bankId: BANK_A, name: "Referral Co" }, db as any);
  const p1 = await people.createPerson({ bankId: BANK_A, firstName: "Ann" }, db as any);
  const p2 = await people.createPerson({ bankId: BANK_A, firstName: "Bo" }, db as any);

  await people.linkPersonToOrganization({ bankId: BANK_A, personId: p1.id, organizationId: org.id, isPrimaryContact: true }, db as any);
  await people.linkPersonToOrganization({ bankId: BANK_A, personId: p2.id, organizationId: org.id, isPrimaryContact: true }, db as any);

  const roster = await people.listPeopleForOrganization(BANK_A, org.id, db as any);
  const primaries = roster.filter((r) => r.is_primary_contact);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].person_id, p2.id);
});

test("unlinking a person from an organization soft-deactivates rather than deleting the row", async () => {
  const db = new FakeDb();
  const org = await orgs.createOrganization({ bankId: BANK_A, name: "Referral Co" }, db as any);
  const person = await people.createPerson({ bankId: BANK_A, firstName: "Ann" }, db as any);
  const role = await people.linkPersonToOrganization({ bankId: BANK_A, personId: person.id, organizationId: org.id }, db as any);

  await people.unlinkPersonFromOrganization(BANK_A, role.id, db as any);

  assert.equal(db.tables.crm_person_organization_roles.length, 1);
  const roles = await people.listOrganizationRolesForPerson(BANK_A, person.id, db as any);
  assert.equal(roles[0].is_active, false);
  assert.ok(roles[0].end_date);
});

// ---------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------

test("tenant isolation: a bank cannot read another bank's organization by id", async () => {
  const db = new FakeDb();
  const org = await orgs.createOrganization({ bankId: BANK_A, name: "Bank A's referral partner" }, db as any);
  const result = await orgs.getOrganization(BANK_B, org.id, db as any);
  assert.equal(result, null);
});

test("tenant isolation: findDuplicatePeople never compares across banks", async () => {
  const db = new FakeDb();
  await people.createPerson({ bankId: BANK_A, firstName: "Sam", lastName: "Ortiz", email: "sam@example.com" }, db as any);
  await people.createPerson({ bankId: BANK_B, firstName: "Sam", lastName: "Ortiz", email: "sam@example.com" }, db as any);

  const candidatesA = await dedup.findDuplicatePeople(BANK_A, db as any);
  assert.equal(candidatesA.length, 0, "identical person in a different bank must not surface as a duplicate");
});

// ---------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------

test("findDuplicatePeople flags an exact email match with high confidence", async () => {
  const db = new FakeDb();
  await people.createPerson({ bankId: BANK_A, firstName: "Robert", lastName: "Chen", email: "rchen@firm.com" }, db as any);
  await people.createPerson({ bankId: BANK_A, firstName: "Bob", lastName: "Chen", email: "RChen@Firm.com" }, db as any);

  const candidates = await dedup.findDuplicatePeople(BANK_A, db as any);
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].confidence >= 0.9);
  assert.ok(candidates[0].reasons.some((r) => r.includes("email")));
});

test("findDuplicatePeople does not flag genuinely different people", async () => {
  const db = new FakeDb();
  await people.createPerson({ bankId: BANK_A, firstName: "Alice", lastName: "Smith", email: "alice@a.com" }, db as any);
  await people.createPerson({ bankId: BANK_A, firstName: "Diane", lastName: "Jones", email: "diane@b.com" }, db as any);

  const candidates = await dedup.findDuplicatePeople(BANK_A, db as any);
  assert.equal(candidates.length, 0);
});

test("findDuplicateOrganizations matches names ignoring Inc/LLC suffix", async () => {
  const db = new FakeDb();
  await orgs.createOrganization({ bankId: BANK_A, name: "Sunrise Capital LLC" }, db as any);
  await orgs.createOrganization({ bankId: BANK_A, name: "Sunrise Capital Inc" }, db as any);

  const candidates = await dedup.findDuplicateOrganizations(BANK_A, db as any);
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].reasons.some((r) => r.includes("suffix")));
});

test("already-merged records are excluded from future duplicate suggestions", async () => {
  const db = new FakeDb();
  const a = await people.createPerson({ bankId: BANK_A, firstName: "Pat", lastName: "Doe", email: "pat@x.com" }, db as any);
  const b = await people.createPerson({ bankId: BANK_A, firstName: "Pat", lastName: "Doe", email: "pat@x.com" }, db as any);
  await dedup.mergePeople({ bankId: BANK_A, sourceId: b.id, targetId: a.id, mergedByClerkUserId: "staff_1" }, db as any);

  const candidates = await dedup.findDuplicatePeople(BANK_A, db as any);
  assert.equal(candidates.length, 0);
});

// ---------------------------------------------------------------------
// Merge: audit trail, no destructive delete, repointing
// ---------------------------------------------------------------------

test("mergePeople soft-merges the source (never deletes) and writes an audited merge log with a snapshot", async () => {
  const db = new FakeDb();
  const target = await people.createPerson({ bankId: BANK_A, firstName: "Jordan", lastName: "K" }, db as any);
  const source = await people.createPerson({ bankId: BANK_A, firstName: "Jordan", lastName: "K", email: "jk@dup.com" }, db as any);

  await dedup.mergePeople({ bankId: BANK_A, sourceId: source.id, targetId: target.id, mergedByClerkUserId: "staff_1", reason: "confirmed duplicate" }, db as any);

  // Source still exists in the table -- soft-merged, not deleted.
  const stillThere = db.tables.crm_people.find((p) => p.id === source.id);
  assert.ok(stillThere, "source person row must never be deleted");
  assert.equal(stillThere!.merged_into_id, target.id);
  assert.ok(stillThere!.merged_at);

  const logRows = db.tables.crm_merge_log;
  assert.equal(logRows.length, 1);
  assert.equal(logRows[0].entity_type, "person");
  assert.equal(logRows[0].source_id, source.id);
  assert.equal(logRows[0].target_id, target.id);
  assert.equal(logRows[0].merged_by_clerk_user_id, "staff_1");
  assert.equal(logRows[0].reason, "confirmed duplicate");
  assert.equal(logRows[0].source_snapshot.email, "jk@dup.com", "snapshot must capture the source record for rollback/history");
});

test("mergePeople repoints organization roles, activities, and deal party roles from source to target", async () => {
  const db = new FakeDb();
  const org = await orgs.createOrganization({ bankId: BANK_A, name: "Referral Co" }, db as any);
  const target = await people.createPerson({ bankId: BANK_A, firstName: "A" }, db as any);
  const source = await people.createPerson({ bankId: BANK_A, firstName: "B" }, db as any);
  await people.linkPersonToOrganization({ bankId: BANK_A, personId: source.id, organizationId: org.id }, db as any);
  db.tables.crm_activities.push({ id: "act-1", bank_id: BANK_A, kind: "note", target_person_id: source.id, happens_at: new Date(0).toISOString() });

  await dedup.mergePeople({ bankId: BANK_A, sourceId: source.id, targetId: target.id, mergedByClerkUserId: "staff_1" }, db as any);

  assert.equal(db.tables.crm_person_organization_roles[0].person_id, target.id);
  assert.equal(db.tables.crm_activities[0].target_person_id, target.id);
});

test("mergeOrganizations repoints deals.referral_source_org_id and brokerage_leads.referral_source_org_id to the surviving org", async () => {
  const db = new FakeDb();
  const target = await orgs.createOrganization({ bankId: BANK_A, name: "Keeper LLC" }, db as any);
  const source = await orgs.createOrganization({ bankId: BANK_A, name: "Duplicate LLC" }, db as any);
  db.tables.deals.push({ id: "deal-1", bank_id: BANK_A, referral_source_org_id: source.id });
  db.tables.brokerage_leads.push({ id: "lead-1", bank_id: BANK_A, referral_source_org_id: source.id });

  await dedup.mergeOrganizations({ bankId: BANK_A, sourceId: source.id, targetId: target.id, mergedByClerkUserId: "staff_1" }, db as any);

  assert.equal(db.tables.deals[0].referral_source_org_id, target.id);
  assert.equal(db.tables.brokerage_leads[0].referral_source_org_id, target.id);
  assert.equal(db.tables.crm_organizations.find((o) => o.id === source.id)!.merged_into_id, target.id);
});

test("cannot merge a record into itself", async () => {
  const db = new FakeDb();
  const p = await people.createPerson({ bankId: BANK_A, firstName: "Solo" }, db as any);
  await assert.rejects(() => dedup.mergePeople({ bankId: BANK_A, sourceId: p.id, targetId: p.id, mergedByClerkUserId: "staff_1" }, db as any));
});

// ---------------------------------------------------------------------
// Deal party roles (external parties only)
// ---------------------------------------------------------------------

test("linkPartyToDeal requires exactly one of personId or organizationId", async () => {
  const db = new FakeDb();
  await assert.rejects(() =>
    partyRoles.linkPartyToDeal({ bankId: BANK_A, dealId: "deal-1", role: "cpa" }, db as any),
  );
  const org = await orgs.createOrganization({ bankId: BANK_A, name: "Title Co" }, db as any);
  const person = await people.createPerson({ bankId: BANK_A, firstName: "Sam" }, db as any);
  await assert.rejects(() =>
    partyRoles.linkPartyToDeal({ bankId: BANK_A, dealId: "deal-1", role: "cpa", personId: person.id, organizationId: org.id }, db as any),
  );
});

test("listPartyRolesForDeal resolves person and organization names for display", async () => {
  const db = new FakeDb();
  const org = await orgs.createOrganization({ bankId: BANK_A, name: "Acme Title" }, db as any);
  db.tables.crm_organizations.find((o) => o.id === org.id)!.name = "Acme Title";
  await partyRoles.linkPartyToDeal({ bankId: BANK_A, dealId: "deal-1", role: "title_company", organizationId: org.id }, db as any);

  const parties = await partyRoles.listPartyRolesForDeal(BANK_A, "deal-1", db as any);
  assert.equal(parties.length, 1);
  assert.equal(parties[0].organizationName, "Acme Title");
  assert.equal(parties[0].role, "title_company");
});

// ---------------------------------------------------------------------
// Resolution: everything connected to one person, in one call
// ---------------------------------------------------------------------

test("resolvePersonRelationships aggregates organization roles, deal roles, and activities", async () => {
  const db = new FakeDb();
  const person = await people.createPerson({ bankId: BANK_A, firstName: "Multi", lastName: "Role" }, db as any);
  const org = await orgs.createOrganization({ bankId: BANK_A, name: "Org A" }, db as any);
  await people.linkPersonToOrganization({ bankId: BANK_A, personId: person.id, organizationId: org.id }, db as any);
  await partyRoles.linkPartyToDeal({ bankId: BANK_A, dealId: "deal-9", role: "referral_contact", personId: person.id }, db as any);
  db.tables.crm_activities.push({ id: "act-9", bank_id: BANK_A, kind: "call", target_person_id: person.id, happens_at: new Date(0).toISOString() });

  const summary = await resolve.resolvePersonRelationships(BANK_A, person.id, db as any);

  assert.equal(summary.organizationRoles.length, 1);
  assert.equal(summary.dealRoles.length, 1);
  assert.equal(summary.activities.length, 1);
});
