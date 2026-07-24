import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const activities = require("../activities") as typeof import("../activities");
const doNotContact = require("../doNotContact") as typeof import("../doNotContact");
const templates = require("../templates") as typeof import("../templates");
const sendEmail = require("../sendEmail") as typeof import("../sendEmail");
const sendSms = require("../sendSms") as typeof import("../sendSms");

type Row = Record<string, any>;
let idCounter = 0;

class FakeDb {
  tables: Record<string, Row[]> = {
    crm_activities: [],
    crm_activity_participants: [],
    crm_people: [],
    brokerage_leads: [],
    crm_message_templates: [],
  };
  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const COLUMN_DEFAULTS: Record<string, any> = {
  follow_up_required: false,
  active: true,
  do_not_contact: false,
};

class FakeQuery {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }> = [];
  _update: Row | null = null;
  _insert: Row[] | null = null;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ t: "eq", k, v });
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
    if (this._insert) return Promise.resolve({ data: { ...this._insert[0] }, error: null });
    if (this._update) {
      this.applyUpdate();
      const rows = this.rowsCopy();
      return Promise.resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } });
    }
    const rows = this.rowsCopy();
    return rows.length ? Promise.resolve({ data: rows[0], error: null }) : Promise.resolve({ data: null, error: { message: "no rows" } });
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this._update) this.applyUpdate();
    return Promise.resolve({ data: this.rowsCopy()[0] ?? null, error: null });
  }
  then(onFulfilled: any, onRejected?: any) {
    if (this._insert) return Promise.resolve({ data: this._insert.map((r) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
    if (this._update) {
      this.applyUpdate();
      return Promise.resolve({ data: this.rowsCopy(), error: null }).then(onFulfilled, onRejected);
    }
    return Promise.resolve({ data: this.rowsCopy(), error: null }).then(onFulfilled, onRejected);
  }
  private rowsCopy(): Row[] {
    return this.rows().map((r) => ({ ...r }));
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
    }
    return true;
  }
  private rows(): Row[] {
    return (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
  }
}

const BANK_A = "bank-a";
const BANK_B = "bank-b";

// ---------------------------------------------------------------------
// Activity participant model
// ---------------------------------------------------------------------

test("logActivity requires exactly one primary target", async () => {
  const db = new FakeDb();
  await assert.rejects(() => activities.logActivity({ bankId: BANK_A, kind: "note", title: "x" }, db as any));
  await assert.rejects(() => activities.logActivity({ bankId: BANK_A, kind: "note", title: "x", dealId: "d1", personId: "p1" }, db as any));
});

test("logActivity attaches multiple participants via the junction table without widening the primary target", async () => {
  const db = new FakeDb();
  const activity = await activities.logActivity(
    { bankId: BANK_A, kind: "meeting", title: "Kickoff call", dealId: "deal-1", participantPersonIds: ["person-1", "person-2"] },
    db as any,
  );

  assert.equal(activity.target_deal_id, "deal-1");
  const participants = await activities.listParticipantsForActivity(BANK_A, activity.id, db as any);
  assert.deepEqual(participants.sort(), ["person-1", "person-2"]);
});

test("legacy activity references are preserved: an activity with no participants has none, not an error", async () => {
  const db = new FakeDb();
  const activity = await activities.logActivity({ bankId: BANK_A, kind: "note", title: "Legacy-style note", dealId: "deal-1" }, db as any);
  const participants = await activities.listParticipantsForActivity(BANK_A, activity.id, db as any);
  assert.deepEqual(participants, []);
});

// ---------------------------------------------------------------------
// Do-not-contact behavior
// ---------------------------------------------------------------------

test("do-not-contact: a flagged person blocks assertPersonContactAllowed", async () => {
  const db = new FakeDb();
  db.tables.crm_people.push({ id: "p1", bank_id: BANK_A, do_not_contact: true, contact_status: "active" });
  await assert.rejects(() => doNotContact.assertPersonContactAllowed(BANK_A, "p1", db as any), doNotContact.DoNotContactError);
});

test("do-not-contact: contact_status='do_not_contact' also blocks, independent of the boolean flag", async () => {
  const db = new FakeDb();
  db.tables.crm_people.push({ id: "p1", bank_id: BANK_A, do_not_contact: false, contact_status: "do_not_contact" });
  await assert.rejects(() => doNotContact.assertPersonContactAllowed(BANK_A, "p1", db as any), doNotContact.DoNotContactError);
});

test("do-not-contact: an allowed person does not throw", async () => {
  const db = new FakeDb();
  db.tables.crm_people.push({ id: "p1", bank_id: BANK_A, do_not_contact: false, contact_status: "active" });
  await assert.doesNotReject(() => doNotContact.assertPersonContactAllowed(BANK_A, "p1", db as any));
});

test("do-not-contact: a flagged lead blocks assertLeadContactAllowed", async () => {
  const db = new FakeDb();
  db.tables.brokerage_leads.push({ id: "lead1", bank_id: BANK_A, do_not_contact: true });
  await assert.rejects(() => doNotContact.assertLeadContactAllowed(BANK_A, "lead1", db as any), doNotContact.DoNotContactError);
});

test("sendCrmEmail refuses to send to a do-not-contact person and logs nothing", async () => {
  const db = new FakeDb();
  db.tables.crm_people.push({ id: "p1", bank_id: BANK_A, do_not_contact: true, contact_status: "active" });

  await assert.rejects(() => sendEmail.sendCrmEmail({ bankId: BANK_A, to: "test@example.com", personId: "p1", subject: "Hi", body: "Hello" }, db as any));
  assert.equal(db.tables.crm_activities.length, 0, "a blocked send must not create an activity — nothing was actually sent");
});

test("sendCrmSms refuses to send to a do-not-contact lead", async () => {
  const db = new FakeDb();
  db.tables.brokerage_leads.push({ id: "lead1", bank_id: BANK_A, do_not_contact: true });
  await assert.rejects(() => sendSms.sendCrmSms({ bankId: BANK_A, to: "+15551234567", leadId: "lead1", body: "Hello" }, db as any));
});

// ---------------------------------------------------------------------
// Email send audit behavior / delivery-state handling / provider failure
// ---------------------------------------------------------------------

test("sendCrmEmail with no RESEND_API_KEY configured honestly logs delivery_state='stub', never 'sent' or 'delivered'", async () => {
  const db = new FakeDb();
  const result = await sendEmail.sendCrmEmail({ bankId: BANK_A, to: "borrower@example.com", dealId: "deal-1", subject: "Welcome", body: "Hi there" }, db as any);

  assert.equal(result.provider, "stub", "test environment has no RESEND_API_KEY — provider must honestly report stub");
  assert.equal(result.providerMessageId, null);
  const activity = db.tables.crm_activities[0];
  assert.equal(activity.kind, "email");
  assert.equal(activity.channel, "email");
  assert.equal(activity.direction, "outbound");
  assert.equal(activity.delivery_state, "stub", "must never claim 'sent'/'delivered' when nothing actually left the server");
  assert.equal(activity.source, "manual");
});

test("sendCrmTemplateEmail renders merge fields and fails clearly when no template exists", async () => {
  const db = new FakeDb();
  await assert.rejects(() =>
    sendEmail.sendCrmTemplateEmail({ bankId: BANK_A, to: "x@example.com", dealId: "deal-1", triggerKey: "initial_lead_response" }, db as any),
  );

  await templates.upsertTemplate({ bankId: BANK_A, triggerKey: "initial_lead_response", channel: "email", subject: "Hi {{first_name}}", body: "Thanks for reaching out, {{first_name}}." }, db as any);
  const result = await sendEmail.sendCrmTemplateEmail(
    { bankId: BANK_A, to: "x@example.com", dealId: "deal-1", triggerKey: "initial_lead_response", mergeFields: { first_name: "Jamie" } },
    db as any,
  );
  const activity = db.tables.crm_activities.find((a) => a.id === (result as any).activity.id)!;
  assert.equal(activity.title, "Hi Jamie");
  assert.equal(activity.properties.body, "Thanks for reaching out, Jamie.");
});

test("sendCrmSms failure (no Twilio configured in this environment) is logged honestly as delivery_state='failed', never faked as sent, and the error still propagates", async () => {
  const db = new FakeDb();
  await assert.rejects(() => sendSms.sendCrmSms({ bankId: BANK_A, to: "+15551234567", dealId: "deal-1", body: "Hello" }, db as any));

  const activity = db.tables.crm_activities.find((a) => a.deal_id === "deal-1" || a.target_deal_id === "deal-1");
  assert.ok(activity, "a failed attempt must still be logged");
  assert.equal(activity.delivery_state, "failed");
  assert.ok(activity.outcome, "failure reason must be recorded");
});

// ---------------------------------------------------------------------
// Templates: merge-field rendering
// ---------------------------------------------------------------------

test("renderTemplate substitutes known fields and leaves unknown placeholders visible rather than silently blanking them", () => {
  const rendered = templates.renderTemplate("Hello {{first_name}}, your {{unknown_field}} is ready.", { first_name: "Sam" });
  assert.equal(rendered, "Hello Sam, your {{unknown_field}} is ready.");
});

// ---------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------

test("tenant isolation: do-not-contact check for a person never leaks across banks", async () => {
  const db = new FakeDb();
  db.tables.crm_people.push({ id: "p1", bank_id: BANK_A, do_not_contact: true, contact_status: "active" });
  // Bank B has no such person — must resolve as "unknown, not blocked" rather than seeing bank A's flag.
  await assert.doesNotReject(() => doNotContact.assertPersonContactAllowed(BANK_B, "p1", db as any));
});
