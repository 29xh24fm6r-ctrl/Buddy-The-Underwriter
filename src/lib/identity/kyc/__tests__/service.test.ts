import { test } from "node:test";
import assert from "node:assert/strict";
import { initiateKyc, handleDiditWebhook, hasValidIal2, mapDiditStatus, reconcileVerification, reconcilePendingVerifications, type DiditClient } from "@/lib/identity/kyc/service";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }> = [];
  _u: Row | null = null;
  _i: Row[] | null = null;
  _l: number | null = null;
  operation: "select" | "insert" | "update" = "select";
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_?: string) {
    this.operation = "select";
    return this;
  }
  order(_k: string, _o?: any) {
    return this;
  }
  limit(n: number) {
    this._l = n;
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ t: "eq", k, v });
    return this;
  }
  in(k: string, v: any[]) {
    this.filters.push({ t: "in", k, v });
    return this;
  }
  not(k: string, _op: string, v: any) {
    this.filters.push({ t: "not_null", k, v });
    return this;
  }
  insert(p: Row | Row[]) {
    this.operation = "insert";
    const rows = Array.isArray(p) ? p : [p];
    const withIds = rows.map((r) => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...withIds);
    this._i = withIds;
    return this;
  }
  update(u: Row) {
    this.operation = "update";
    this._u = u;
    return this;
  }
  single(): Promise<{ data: any; error: any }> {
    const failure = this.db.failures[`${this.table}:${this.operation}`];
    if (failure) return Promise.resolve({ data: null, error: { message: failure } });
    if (this._i) return Promise.resolve({ data: this._i[0], error: null });
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    const failure = this.db.failures[`${this.table}:${this.operation}`];
    if (failure) return Promise.resolve({ data: null, error: { message: failure } });
    if (this._u) {
      this.applyUpdate();
      return Promise.resolve({ data: this.rows()[0], error: null });
    }
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(resolve: any, reject?: any) {
    const failure = this.db.failures[`${this.table}:${this.operation}`];
    if (failure) {
      return Promise.resolve({ data: null, error: { message: failure } }).then(resolve, reject);
    }
    if (this._u) {
      this.applyUpdate();
      return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
    }
    if (this._i) return Promise.resolve({ data: this._i, error: null }).then(resolve, reject);
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
  private applyUpdate() {
    for (const r of this.rows()) Object.assign(r, this._u);
  }
  private rows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "eq") rows = rows.filter((r) => r[f.k] === f.v);
      else if (f.t === "in") rows = rows.filter((r) => (f.v as any[]).includes(r[f.k]));
      else if (f.t === "not_null") rows = rows.filter((r) => r[f.k] != null);
    }
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  failures: Record<string, string>;
  constructor(seed?: Partial<Record<string, Row[]>>, failures?: Record<string, string>) {
    this.tables = {
      borrower_identity_verifications: [],
      ownership_entities: [],
      deal_events: [],
      ...seed,
    };
    this.failures = failures ?? {};
  }
  from(t: string) {
    return new Q(this, t);
  }
}

function fakeDidit(overrides?: Partial<DiditClient>): DiditClient {
  let createCallCount = 0;
  return {
    createDiditSession: async () => {
      createCallCount++;
      return { session_id: `sess_${createCallCount}`, status: "Not Started", workflow_id: "wf_1", url: `https://verify.didit.me/session/sess_${createCallCount}` };
    },
    fetchDiditSession: async (id: string) => ({ session_id: id, status: "Approved", workflow_id: "wf_1", url: `https://verify.didit.me/session/${id}` }),
    getDiditSessionDecision: async (id: string) => ({ session_id: id, status: "Approved" }),
    ...overrides,
  };
}

test("initiateKyc: no existing -> creates new + writes deal_event", async () => {
  const db = new FakeDb({ ownership_entities: [{ id: "o1", display_name: "Jane Doe" }] });
  const didit = fakeDidit();
  const r = await initiateKyc(
    { dealId: "d1", bankId: "b1", ownershipEntityId: "o1", initiatorUserId: "u1" },
    { sb: db as any, didit, workflowId: "wf_1" },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reused, false);
    assert.equal(db.tables.borrower_identity_verifications.length, 1);
    assert.equal(db.tables.borrower_identity_verifications[0].vendor, "didit");
    assert.ok(db.tables.deal_events.some((e) => e.kind === "kyc.verification_initiated"));
  }
});

test("initiateKyc: existing pending -> reuses stored session_url, no new session created", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", status: "pending", vendor_inquiry_id: "sess_existing", vendor_artifacts_url: "https://verify.didit.me/session/sess_existing", created_at: "2026-01-01" },
    ],
    ownership_entities: [{ id: "o1", display_name: "Jane Doe" }],
  });
  let createCalled = false;
  const didit = fakeDidit({ createDiditSession: async () => { createCalled = true; return { session_id: "sess_new", status: "Not Started", workflow_id: "wf_1", url: "https://verify.didit.me/session/sess_new" }; } });
  const r = await initiateKyc(
    { dealId: "d1", bankId: "b1", ownershipEntityId: "o1", initiatorUserId: "u1" },
    { sb: db as any, didit, workflowId: "wf_1" },
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reused, true);
    assert.equal(r.sessionUrl, "https://verify.didit.me/session/sess_existing");
  }
  assert.equal(createCalled, false);
  assert.equal(db.tables.borrower_identity_verifications.length, 1);
});

test("initiateKyc: missing owner -> OWNER_NOT_FOUND", async () => {
  const db = new FakeDb();
  const didit = fakeDidit();
  const r = await initiateKyc(
    { dealId: "d1", bankId: "b1", ownershipEntityId: "o-missing", initiatorUserId: "u1" },
    { sb: db as any, didit, workflowId: "wf_1" },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "OWNER_NOT_FOUND");
});

test("handleDiditWebhook: status=Approved -> updates record, sets completed_at", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [{ id: "v1", deal_id: "d1", vendor_inquiry_id: "sess_1", status: "pending" }],
  });
  const didit = fakeDidit({
    fetchDiditSession: async (id) => ({ session_id: id, status: "Approved", workflow_id: "wf_1", url: "https://verify.didit.me/session/sess_1" }),
  });
  const r = await handleDiditWebhook({ session_id: "sess_1", status: "Approved", webhook_type: "status.updated" }, { sb: db as any, didit });
  assert.equal(r.ok, true);
  const rec = db.tables.borrower_identity_verifications[0];
  assert.equal(rec.status, "approved");
  assert.ok(rec.completed_at);
});

test("handleDiditWebhook: status=Declined -> updates record, no completed_at", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [{ id: "v1", deal_id: "d1", vendor_inquiry_id: "sess_1", status: "pending" }],
  });
  const didit = fakeDidit({
    fetchDiditSession: async (id) => ({ session_id: id, status: "Declined", workflow_id: "wf_1", url: "https://verify.didit.me/session/sess_1" }),
  });
  const r = await handleDiditWebhook({ session_id: "sess_1", status: "Declined", webhook_type: "status.updated" }, { sb: db as any, didit });
  assert.equal(r.ok, true);
  const rec = db.tables.borrower_identity_verifications[0];
  assert.equal(rec.status, "declined");
  assert.equal(rec.completed_at, undefined);
});

test("handleDiditWebhook: missing session_id -> MISSING_SESSION_ID", async () => {
  const db = new FakeDb();
  const didit = fakeDidit();
  const r = await handleDiditWebhook({}, { sb: db as any, didit });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "MISSING_SESSION_ID");
});

test("hasValidIal2: completed + completed_at set -> true", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", status: "completed", completed_at: "2026-01-01" },
    ],
  });
  const r = await hasValidIal2("d1", "o1", db as any);
  assert.equal(r, true);
});

test("hasValidIal2: only pending -> false", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", status: "pending", completed_at: null },
    ],
  });
  const r = await hasValidIal2("d1", "o1", db as any);
  assert.equal(r, false);
});

test("hasValidIal2: declined -> false", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", status: "declined", completed_at: null },
    ],
  });
  const r = await hasValidIal2("d1", "o1", db as any);
  assert.equal(r, false);
});

test("mapDiditStatus: maps every documented Didit session status", () => {
  assert.equal(mapDiditStatus("Not Started"), "created");
  assert.equal(mapDiditStatus("In Progress"), "pending");
  assert.equal(mapDiditStatus("Approved"), "approved");
  assert.equal(mapDiditStatus("Declined"), "declined");
  assert.equal(mapDiditStatus("In Review"), "needs_review");
  assert.equal(mapDiditStatus("Expired"), "expired");
  assert.equal(mapDiditStatus("KYC Expired"), "expired");
  assert.equal(mapDiditStatus("Abandoned"), "failed");
});


// ── Reconciliation ───────────────────────────────────────────────────────
//
// Regression cover for the 2026-08-25 incident: Didit session 252f29e1 was
// `Approved` while borrower_identity_verifications sat at `created` with
// completed_at NULL, because the completion webhook was never delivered.
// Nothing in the product went and looked, so the borrower was stranded
// behind the sealing gate with no control that could advance anything.

test("reconcileVerification: stranded 'created' row whose vendor session is Approved becomes approved + completed_at", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      {
        id: "v1",
        deal_id: "d1",
        ownership_entity_id: "o1",
        vendor: "didit",
        vendor_inquiry_id: "sess_1",
        status: "created",
        completed_at: null,
        created_at: "2026-08-25",
      },
    ],
  });

  const r = await reconcileVerification("v1", { sb: db as any, didit: fakeDidit() });

  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.previousStatus, "created");
    assert.equal(r.status, "approved");
    assert.equal(r.changed, true);
  }

  const row = db.tables.borrower_identity_verifications[0];
  assert.equal(row.status, "approved");
  assert.ok(row.completed_at, "completed_at must be stamped so hasValidIal2 passes");

  // The deal timeline has to record that the status moved and that it moved
  // via reconciliation rather than a webhook.
  const event = db.tables.deal_events.find((e) => e.kind === "kyc.verification_approved");
  assert.ok(event, "expected a kyc.verification_approved deal event");
  assert.equal(event!.payload.source, "reconcile");
  assert.equal(event!.payload.previous_status, "created");
});

test("reconcileVerification: hasValidIal2 flips from false to true after reconciling", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", vendor: "didit", vendor_inquiry_id: "sess_1", status: "created", completed_at: null, created_at: "2026-08-25" },
    ],
  });

  assert.equal(await hasValidIal2("d1", "o1", db as any), false);
  await reconcileVerification("v1", { sb: db as any, didit: fakeDidit() });
  assert.equal(await hasValidIal2("d1", "o1", db as any), true);
});

test("reconcileVerification: idempotent — a second call writes nothing new", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", vendor: "didit", vendor_inquiry_id: "sess_1", status: "created", completed_at: null, created_at: "2026-08-25" },
    ],
  });

  await reconcileVerification("v1", { sb: db as any, didit: fakeDidit() });
  const eventsAfterFirst = db.tables.deal_events.length;
  const completedAt = db.tables.borrower_identity_verifications[0].completed_at;

  const second = await reconcileVerification("v1", { sb: db as any, didit: fakeDidit() });

  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.changed, false);
  assert.equal(db.tables.deal_events.length, eventsAfterFirst, "must not churn deal_events");
  assert.equal(db.tables.borrower_identity_verifications[0].completed_at, completedAt);
});

test("reconcileVerification: mock_didit rows are never promoted by a real vendor lookup", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", vendor: "mock_didit", vendor_inquiry_id: "sess_1", status: "created", completed_at: null, created_at: "2026-08-25" },
    ],
  });

  const r = await reconcileVerification("v1", { sb: db as any, didit: fakeDidit() });

  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "NO_VENDOR_SESSION");
  assert.equal(db.tables.borrower_identity_verifications[0].status, "created");
});

test("reconcileVerification: vendor failure leaves the row untouched and reports why", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", vendor: "didit", vendor_inquiry_id: "sess_1", status: "created", completed_at: null, created_at: "2026-08-25" },
    ],
  });

  const didit = fakeDidit({
    fetchDiditSession: async () => { throw new Error("Didit API /session/ failed: 503"); },
  });

  const r = await reconcileVerification("v1", { sb: db as any, didit });

  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "VENDOR_FETCH_FAILED");
    assert.match(r.detail ?? "", /503/);
  }
  assert.equal(db.tables.borrower_identity_verifications[0].status, "created");
});

test("reconcilePendingVerifications: one dead session does not stop the rest of the batch", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", vendor: "didit", vendor_inquiry_id: "bad", status: "created", completed_at: null, created_at: "2026-08-25T01:00:00Z" },
      { id: "v2", deal_id: "d1", ownership_entity_id: "o2", vendor: "didit", vendor_inquiry_id: "good", status: "created", completed_at: null, created_at: "2026-08-25T02:00:00Z" },
    ],
  });

  const didit = fakeDidit({
    fetchDiditSession: async (id: string) => {
      if (id === "bad") throw new Error("gone");
      return { session_id: id, status: "Approved", workflow_id: "wf_1", url: "https://verify.didit.me/x" };
    },
  });

  const result = await reconcilePendingVerifications({ dealId: "d1" }, { sb: db as any, didit });

  assert.equal(result.examined, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.changed, 1);
  assert.equal(db.tables.borrower_identity_verifications.find((r) => r.id === "v2")!.status, "approved");
});

test("reconcilePendingVerifications: already-approved rows are not re-examined", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", vendor: "didit", vendor_inquiry_id: "sess_1", status: "approved", completed_at: "2026-08-25", created_at: "2026-08-25" },
    ],
  });

  let fetched = 0;
  const didit = fakeDidit({
    fetchDiditSession: async (id: string) => {
      fetched++;
      return { session_id: id, status: "Approved", workflow_id: "wf_1", url: "https://verify.didit.me/x" };
    },
  });

  const result = await reconcilePendingVerifications({ dealId: "d1" }, { sb: db as any, didit });

  assert.equal(result.examined, 0);
  assert.equal(fetched, 0);
});

test("reconcileVerification: a Declined vendor session lands as declined, not silently approved", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      { id: "v1", deal_id: "d1", ownership_entity_id: "o1", vendor: "didit", vendor_inquiry_id: "sess_1", status: "pending", completed_at: null, created_at: "2026-08-25" },
    ],
  });

  const didit = fakeDidit({
    fetchDiditSession: async (id: string) => ({ session_id: id, status: "Declined", workflow_id: "wf_1", url: "https://verify.didit.me/x" }),
  });

  const r = await reconcileVerification("v1", { sb: db as any, didit });

  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.status, "declined");
  const row = db.tables.borrower_identity_verifications[0];
  assert.equal(row.status, "declined");
  assert.equal(row.completed_at, null, "a declined verification must never be stamped complete");
  assert.equal(await hasValidIal2("d1", "o1", db as any), false);
});


test("reconcileVerification: performs one canonical vendor read and no redundant decision request", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: [
      {
        id: "v1",
        deal_id: "d1",
        ownership_entity_id: "o1",
        vendor: "didit",
        vendor_inquiry_id: "sess_1",
        status: "created",
        completed_at: null,
        created_at: "2026-08-25",
      },
    ],
  });

  let canonicalReads = 0;
  let redundantDecisionReads = 0;
  const didit = fakeDidit({
    fetchDiditSession: async (id: string) => {
      canonicalReads += 1;
      return { session_id: id, status: "Approved" };
    },
    getDiditSessionDecision: async (id: string) => {
      redundantDecisionReads += 1;
      return { session_id: id, status: "Approved" };
    },
  });

  const result = await reconcileVerification("v1", { sb: db as any, didit });

  assert.equal(result.ok, true);
  assert.equal(canonicalReads, 1, "reconciliation should read canonical vendor state exactly once");
  assert.equal(redundantDecisionReads, 0, "successful reconciliation must not repeat the same decision GET");
  assert.equal(db.tables.borrower_identity_verifications[0].status, "approved");
  assert.ok(db.tables.borrower_identity_verifications[0].completed_at);
});

test("handleDiditWebhook: database lookup failure is retryable and never acknowledged as not found", async () => {
  const db = new FakeDb(
    {
      borrower_identity_verifications: [
        { id: "v1", deal_id: "d1", vendor_inquiry_id: "sess_1", status: "pending" },
      ],
    },
    { "borrower_identity_verifications:select": "database unavailable" },
  );

  await assert.rejects(
    () => handleDiditWebhook({ session_id: "sess_1" }, { sb: db as any, didit: fakeDidit() }),
    /didit_webhook_record_lookup_failed: database unavailable/,
  );
  assert.equal(db.tables.borrower_identity_verifications[0].status, "pending");
  assert.equal(db.tables.deal_events.length, 0);
});

test("handleDiditWebhook: database update failure throws so the provider can retry", async () => {
  const db = new FakeDb(
    {
      borrower_identity_verifications: [
        { id: "v1", deal_id: "d1", vendor_inquiry_id: "sess_1", status: "pending" },
      ],
    },
    { "borrower_identity_verifications:update": "write rejected" },
  );

  await assert.rejects(
    () => handleDiditWebhook({ session_id: "sess_1" }, { sb: db as any, didit: fakeDidit() }),
    /didit_webhook_status_update_failed: write rejected/,
  );
  assert.equal(db.tables.borrower_identity_verifications[0].status, "pending");
  assert.equal(db.tables.deal_events.length, 0);
});

test("reconcileVerification: database read failure is not misreported as a missing verification", async () => {
  const db = new FakeDb(undefined, {
    "borrower_identity_verifications:select": "database unavailable",
  });

  const result = await reconcileVerification("v1", { sb: db as any, didit: fakeDidit() });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "DB_READ_FAILED");
    assert.equal(result.detail, "database unavailable");
  }
});

test("reconcileVerification: database update failure leaves durable state unchanged and reports failure", async () => {
  const db = new FakeDb(
    {
      borrower_identity_verifications: [
        {
          id: "v1",
          deal_id: "d1",
          ownership_entity_id: "o1",
          vendor: "didit",
          vendor_inquiry_id: "sess_1",
          status: "created",
          completed_at: null,
          created_at: "2026-08-25",
        },
      ],
    },
    { "borrower_identity_verifications:update": "write rejected" },
  );

  const result = await reconcileVerification("v1", { sb: db as any, didit: fakeDidit() });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "DB_UPDATE_FAILED");
    assert.equal(result.detail, "write rejected");
  }
  assert.equal(db.tables.borrower_identity_verifications[0].status, "created");
  assert.equal(db.tables.borrower_identity_verifications[0].completed_at, null);
  assert.equal(db.tables.deal_events.length, 0);
});

test("handleDiditWebhook: audit write failure is not acknowledged after durable status changes", async () => {
  const db = new FakeDb(
    {
      borrower_identity_verifications: [
        { id: "v1", deal_id: "d1", vendor_inquiry_id: "sess_1", status: "pending" },
      ],
    },
    { "deal_events:insert": "audit unavailable" },
  );

  await assert.rejects(
    () => handleDiditWebhook({ session_id: "sess_1" }, { sb: db as any, didit: fakeDidit() }),
    /didit_webhook_audit_event_failed: audit unavailable/,
  );
  assert.equal(db.tables.borrower_identity_verifications[0].status, "approved");
});

