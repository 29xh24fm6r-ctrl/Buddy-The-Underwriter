import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const stages = require("../stages") as typeof import("../stages");
const qualification = require("../qualification") as typeof import("../qualification");
const sla = require("../sla") as typeof import("../sla");
const pipeline = require("../pipeline") as typeof import("../pipeline");
const convert = require("../convert") as typeof import("../convert");
const queries = require("../queries") as typeof import("../queries");
const leadsWrite = require("../../brokerage/leads") as typeof import("../../brokerage/leads");

type Row = Record<string, any>;
let idCounter = 0;

/** Minimal in-memory fake Supabase client, extending PR1's pattern
 * (src/lib/crm/__tests__/relationshipGraph.test.ts) with lt/gte/ilike,
 * which PR2's SLA/dedup queries need. */
class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = {
      brokerage_leads: [],
      brokerage_lead_qualifications: [],
      crm_activities: [],
      crm_organizations: [],
      deals: [],
      deal_source_attribution: [],
      deal_party_roles: [],
      borrowers: [],
      deal_audit_log: [],
      ...seed,
    };
  }
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const COLUMN_DEFAULTS: Record<string, any> = {
  priority: "medium",
  status: "new",
  duplicate_of: null,
};

class FakeQuery {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }>;
  _update: Row | null = null;
  _insert: Row[] | null = null;
  _limit: number | null = null;
  _order: { key: string; asc: boolean } | null = null;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
    this.filters = [];
  }
  select() {
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
  lt(k: string, v: any) {
    this.filters.push({ t: "lt", k, v });
    return this;
  }
  gte(k: string, v: any) {
    this.filters.push({ t: "gte", k, v });
    return this;
  }
  ilike(k: string, v: string) {
    this.filters.push({ t: "ilike", k, v });
    return this;
  }
  or() {
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
  single(): Promise<{ data: any; error: any }> {
    if (this._insert) return Promise.resolve({ data: this._insert[0], error: null });
    if (this._update) {
      this.applyUpdate();
      const rows = this.rows();
      return Promise.resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } });
    }
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
    return Promise.resolve({ data: this.rows(), error: null }).then(onFulfilled, onRejected);
  }
  private applyUpdate() {
    for (const row of this.rows()) Object.assign(row, this._update);
  }
  private field(row: Row, key: string): any {
    return key in row ? row[key] : COLUMN_DEFAULTS[key];
  }
  private matches(row: Row): boolean {
    for (const f of this.filters) {
      const val = this.field(row, f.k);
      if (f.t === "eq" && val !== f.v) return false;
      if (f.t === "is" && val !== f.v) return false;
      if (f.t === "in" && !(f.v as any[]).includes(val)) return false;
      if (f.t === "lt" && !(val != null && val < f.v)) return false;
      if (f.t === "gte" && !(val != null && val >= f.v)) return false;
      if (f.t === "ilike") {
        const pattern = String(f.v).toLowerCase();
        const target = String(val ?? "").toLowerCase();
        if (pattern.includes("%")) {
          const re = new RegExp(pattern.split("%").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
          if (!re.test(target)) return false;
        } else if (target !== pattern) {
          return false;
        }
      }
    }
    return true;
  }
  private rows(): Row[] {
    let rows = (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
    if (this._order) {
      const { key, asc } = this._order;
      rows = [...rows].sort((a, b) => (a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1));
    }
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return rows;
  }
}

const BANK_A = "bank-a";
const BANK_B = "bank-b";

function makeLead(db: FakeDb, overrides: Row = {}): Row {
  const row = {
    id: `lead-${++idCounter}`,
    bank_id: BANK_A,
    status: "new",
    priority: "medium",
    stage_entered_at: new Date(0).toISOString(),
    created_at: new Date(0).toISOString(),
    business_name: null,
    email: null,
    next_action_due_at: null,
    last_attempted_contact_at: null,
    last_successful_contact_at: null,
    ...overrides,
  };
  db.tables.brokerage_leads.push(row);
  return row;
}

// ---------------------------------------------------------------------
// Lead-stage transition matrix
// ---------------------------------------------------------------------

test("stage transition matrix: forward flow is allowed, skipping stages is not", async () => {
  assert.equal(stages.canTransition("new", "attempting_contact"), true);
  assert.equal(stages.canTransition("new", "qualified"), false, "cannot skip straight from new to qualified");
  assert.equal(stages.canTransition("qualified", "engagement_pending"), true);
});

test("stage transition matrix: terminal stages allow no further transitions", async () => {
  for (const terminal of ["converted", "disqualified", "withdrawn", "lost"] as const) {
    assert.equal(stages.ALLOWED_TRANSITIONS[terminal].length, 0, `${terminal} must be terminal`);
    assert.equal(stages.isTerminalStage(terminal), true);
  }
});

test("transitionLeadStage rejects a transition not in the allowed matrix", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "new" });
  await assert.rejects(() =>
    pipeline.transitionLeadStage({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", toStage: "qualified" }, db as any),
  );
});

test("transitionLeadStage cannot set 'converted' directly — only convertLeadToDeal can", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "application_started" });
  await assert.rejects(() =>
    pipeline.transitionLeadStage({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", toStage: "converted" }, db as any),
  );
});

test("transitionLeadStage writes an audited stage_change activity", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "new" });
  await pipeline.transitionLeadStage({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", toStage: "attempting_contact" }, db as any);

  const activity = db.tables.crm_activities.find((a) => a.target_lead_id === lead.id);
  assert.ok(activity);
  assert.equal(activity!.kind, "stage_change");
  assert.equal(activity!.properties.toStage, "attempting_contact");
});

// ---------------------------------------------------------------------
// Lost and disqualified reason enforcement
// ---------------------------------------------------------------------

test("a lead cannot be marked disqualified without a reason", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "new" });
  await assert.rejects(() =>
    pipeline.transitionLeadStage({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", toStage: "disqualified" }, db as any),
  );
  const withReason = await pipeline.transitionLeadStage(
    { bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", toStage: "disqualified", reason: "not SBA-eligible" },
    db as any,
  );
  assert.equal(withReason.disqualification_reason, "not SBA-eligible");
});

test("a lead cannot be marked lost without a reason", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "engagement_pending", next_action_due_at: new Date().toISOString() });
  await assert.rejects(() =>
    pipeline.transitionLeadStage({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", toStage: "lost" }, db as any),
  );
  const withReason = await pipeline.transitionLeadStage(
    { bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", toStage: "lost", reason: "went with a bank direct" },
    db as any,
  );
  assert.equal(withReason.lost_reason, "went with a bank direct");
});

test("entering 'qualified' or 'engagement_pending' requires a next-action due date", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "preliminary_qualification" });
  await assert.rejects(() =>
    pipeline.transitionLeadStage({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", toStage: "qualified" }, db as any),
  );
  const withDue = await pipeline.transitionLeadStage(
    { bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", toStage: "qualified", nextActionDueAt: new Date().toISOString() },
    db as any,
  );
  assert.equal(withDue.status, "qualified");
});

// ---------------------------------------------------------------------
// Contact attempts
// ---------------------------------------------------------------------

test("recording a first contact attempt on a new lead advances it to attempting_contact", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "new" });
  const updated = await pipeline.recordLeadContactAttempt(
    { bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", channel: "call", outcome: "no_answer" },
    db as any,
  );
  assert.equal(updated.status, "attempting_contact");
  assert.ok(updated.last_attempted_contact_at);
  assert.equal(updated.last_successful_contact_at, null);
});

test("a connected contact attempt also sets last_successful_contact_at", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "attempting_contact" });
  const updated = await pipeline.recordLeadContactAttempt(
    { bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", channel: "call", outcome: "connected" },
    db as any,
  );
  assert.ok(updated.last_successful_contact_at);
});

// ---------------------------------------------------------------------
// Qualification provenance
// ---------------------------------------------------------------------

test("qualification fields default to 'unknown' provenance and are never silently treated as verified", async () => {
  const db = new FakeDb();
  const lead = makeLead(db);
  const q = await qualification.upsertQualification(
    { bankId: BANK_A, leadId: lead.id, createdByClerkUserId: "staff_1", fields: { annual_revenue_estimate: 2_000_000 } },
    db as any,
  );
  assert.equal(qualification.fieldProvenance(q, "annual_revenue_estimate"), "unknown");
  assert.equal(qualification.isFieldVerified(q, "annual_revenue_estimate"), false);
});

test("qualification provenance can be explicitly upgraded per field without affecting other fields", async () => {
  const db = new FakeDb();
  const lead = makeLead(db);
  await qualification.upsertQualification(
    { bankId: BANK_A, leadId: lead.id, fields: { credit_estimate: "700+", annual_revenue_estimate: 1_000_000 }, provenance: { credit_estimate: "borrower_stated" } },
    db as any,
  );
  const q2 = await qualification.upsertQualification(
    { bankId: BANK_A, leadId: lead.id, fields: {}, provenance: { annual_revenue_estimate: "verified" } },
    db as any,
  );
  assert.equal(qualification.fieldProvenance(q2, "credit_estimate"), "borrower_stated", "earlier provenance must be preserved across upserts");
  assert.equal(qualification.fieldProvenance(q2, "annual_revenue_estimate"), "verified");
  assert.equal(qualification.isFieldVerified(q2, "annual_revenue_estimate"), true);
});

// ---------------------------------------------------------------------
// SLA calculations
// ---------------------------------------------------------------------

test("businessHoursSince excludes weekends", async () => {
  const friday9am = new Date("2026-07-17T09:00:00Z"); // a Friday
  const monday9am = new Date("2026-07-20T09:00:00Z");
  const hours = sla.businessHoursSince(friday9am, monday9am);
  assert.equal(hours, 24, "should count Fri 9am->Fri midnight (15h) + Mon midnight->9am (9h) = 24 business hours, skipping the weekend");
});

test("a new lead with no contact attempt becomes first-contact-overdue after the business-hour SLA window", async () => {
  const created = new Date("2026-07-17T09:00:00Z");
  const wellPastSla = new Date("2026-07-17T12:00:00Z");
  const state = sla.computeLeadSlaState(
    { status: "new", created_at: created.toISOString(), last_attempted_contact_at: null, next_action_due_at: null },
    wellPastSla,
  );
  assert.equal(state.firstContactOverdue, true);
  assert.equal(state.isOverdue, true);
});

test("a lead already contacted is not first-contact-overdue even long after creation", async () => {
  const state = sla.computeLeadSlaState(
    { status: "contacted", created_at: "2026-01-01T00:00:00Z", last_attempted_contact_at: "2026-01-01T01:00:00Z", next_action_due_at: null },
    new Date("2026-07-17T00:00:00Z"),
  );
  assert.equal(state.firstContactOverdue, false);
});

test("qualified stage without a next-action due date is flagged overdue", async () => {
  const state = sla.computeLeadSlaState(
    { status: "qualified", created_at: "2026-01-01T00:00:00Z", last_attempted_contact_at: "2026-01-01T01:00:00Z", next_action_due_at: null },
    new Date("2026-07-17T00:00:00Z"),
  );
  assert.equal(state.missingRequiredNextAction, true);
  assert.equal(state.isOverdue, true);
});

// ---------------------------------------------------------------------
// Tenant scoping
// ---------------------------------------------------------------------

test("tenant isolation: a bank cannot transition another bank's lead", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { bank_id: BANK_A, status: "new" });
  await assert.rejects(() =>
    pipeline.transitionLeadStage({ bankId: BANK_B, leadId: lead.id, actorClerkUserId: "staff_1", toStage: "attempting_contact" }, db as any),
  );
});

test("tenant isolation: lead queues never cross banks", async () => {
  const db = new FakeDb();
  makeLead(db, { bank_id: BANK_A, status: "new" });
  makeLead(db, { bank_id: BANK_B, status: "new" });

  const queueA = await queries.listLeadQueue({ bankId: BANK_A, queue: "all" }, db as any);
  assert.equal(queueA.length, 1);
  assert.equal(queueA[0].bank_id, BANK_A);
});

// ---------------------------------------------------------------------
// Lead conversion: idempotency, duplicate prevention, referral attribution
// ---------------------------------------------------------------------

test("convertLeadToDeal creates a borrower and deal, marks the lead converted, and remains idempotent on a second call", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "application_started", business_name: "Acme Bakery", email: "owner@acmebakery.com" });

  const first = await convert.convertLeadToDeal({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1" }, db as any);
  assert.equal(first.reused, false);
  assert.ok(first.dealId);
  assert.ok(first.borrowerId);

  const updatedLead = db.tables.brokerage_leads.find((l) => l.id === lead.id);
  assert.equal(updatedLead!.status, "converted");
  assert.equal(updatedLead!.converted_deal_id, first.dealId);
  assert.equal(db.tables.deals.length, 1);
  assert.equal(db.tables.borrowers.length, 1);

  // Idempotent: converting the same (now-converted) lead again returns the same deal, creates nothing new.
  const second = await convert.convertLeadToDeal({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1" }, db as any);
  assert.equal(second.dealId, first.dealId);
  assert.equal(second.reused, true);
  assert.equal(db.tables.deals.length, 1, "must not create a second deal for an already-converted lead");
});

test("convertLeadToDeal refuses to convert a lead in a terminal negative stage", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "disqualified", disqualification_reason: "ineligible" });
  await assert.rejects(() => convert.convertLeadToDeal({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1" }, db as any));
});

test("convertLeadToDeal reuses an existing recent duplicate deal rather than creating a second one", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "application_started", business_name: "Existing Corp" });
  db.tables.deals.push({
    id: "deal-existing",
    bank_id: BANK_A,
    name: `Existing Corp — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
    created_by_user_id: "staff_1",
    created_at: new Date().toISOString(),
  });

  const result = await convert.convertLeadToDeal({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1" }, db as any);
  assert.equal(result.dealId, "deal-existing");
  assert.equal(result.reused, true);
  assert.equal(db.tables.deals.length, 1, "must not create a duplicate deal within the dedup window");
});

test("convertLeadToDeal links to a staff-chosen existing borrower instead of creating a new one", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "application_started", business_name: "Choice Co" });
  db.tables.borrowers.push({ id: "borrower-existing", bank_id: BANK_A, legal_name: "Choice Co" });

  const result = await convert.convertLeadToDeal({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1", borrowerId: "borrower-existing" }, db as any);
  assert.equal(result.borrowerId, "borrower-existing");
  assert.equal(db.tables.borrowers.length, 1, "must not create a second borrower when staff picked an existing one");
});

test("convertLeadToDeal preserves referral attribution: deal_source_attribution and a referral_source deal party role are created", async () => {
  const db = new FakeDb();
  const org = { id: "org-1", bank_id: BANK_A, name: "Referral Partner LLC" };
  db.tables.crm_organizations.push(org);
  const lead = makeLead(db, { status: "application_started", business_name: "Referred Biz", referral_source_org_id: org.id, source: "referral_partner" });

  const result = await convert.convertLeadToDeal({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1" }, db as any);

  const attribution = db.tables.deal_source_attribution.find((a) => a.deal_id === result.dealId);
  assert.ok(attribution, "deal_source_attribution row must be created");
  assert.equal(attribution!.referring_organization_id, org.id);

  const partyRole = db.tables.deal_party_roles.find((p) => p.deal_id === result.dealId);
  assert.ok(partyRole, "referral org must be linked as an external deal party");
  assert.equal(partyRole!.role, "referral_source");
  assert.equal(partyRole!.organization_id, org.id);
});

test("convertLeadToDeal writes deal_created and lead_converted audit events", async () => {
  const db = new FakeDb();
  const lead = makeLead(db, { status: "application_started", business_name: "Audited Co" });
  const result = await convert.convertLeadToDeal({ bankId: BANK_A, leadId: lead.id, actorClerkUserId: "staff_1" }, db as any);

  const events = db.tables.deal_audit_log.filter((e) => e.deal_id === result.dealId).map((e) => e.event);
  assert.ok(events.includes("deal_created"));
  assert.ok(events.includes("lead_converted"));
});

test("previewConvertLeadToDeal surfaces duplicate borrower candidates without creating anything", async () => {
  const db = new FakeDb();
  db.tables.borrowers.push({ id: "borrower-1", bank_id: BANK_A, legal_name: "Preview Co", primary_contact_email: null });
  const lead = makeLead(db, { status: "application_started", business_name: "Preview Co" });

  const preview = await convert.previewConvertLeadToDeal(BANK_A, lead.id, db as any);
  assert.equal(preview.duplicateBorrowerCandidates.length, 1);
  assert.equal(preview.duplicateBorrowerCandidates[0].id, "borrower-1");
  assert.equal(db.tables.borrowers.length, 1, "preview must not create a borrower");
  assert.equal(db.tables.deals.length, 0, "preview must not create a deal");
});

// ---------------------------------------------------------------------
// Existing automatic concierge lead capture remains functional
// ---------------------------------------------------------------------

test("upsertBrokerageLead still writes a plain 'new' lead after the status CHECK constraint was widened", async () => {
  const db = new FakeDb();
  const result = await leadsWrite.upsertBrokerageLead(
    { bankId: BANK_A, source: "concierge_chat", email: "borrower@example.com" },
    db as any,
  );
  assert.ok(result);
  const row = db.tables.brokerage_leads.find((l) => l.id === result!.id);
  assert.equal(row!.status, "new");
});

test("upsertBrokerageLead still marks a lead 'converted' when a dealId is supplied (concierge auto-conversion path)", async () => {
  const db = new FakeDb();
  const result = await leadsWrite.upsertBrokerageLead(
    { bankId: BANK_A, source: "concierge_chat", email: "borrower2@example.com", dealId: "deal-concierge-1" },
    db as any,
  );
  const row = db.tables.brokerage_leads.find((l) => l.id === result!.id);
  assert.equal(row!.status, "converted");
  assert.equal(row!.converted_deal_id, "deal-concierge-1");
});
