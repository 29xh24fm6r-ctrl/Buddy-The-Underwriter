import { test } from "node:test";
import assert from "node:assert/strict";
import { requestSignature, handleDocusealWebhook, type DocusealClient } from "@/lib/esign/docuseal/service";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }> = [];
  _i: Row[] | null = null;
  _l: number | null = null;
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_?: string) {
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
    const rows = Array.isArray(p) ? p : [p];
    const withIds = rows.map((r) => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...withIds);
    this._i = withIds;
    return this;
  }
  single(): Promise<{ data: any; error: any }> {
    if (this._i) return Promise.resolve({ data: this._i[0], error: null });
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(resolve: any, reject?: any) {
    if (this._i) return Promise.resolve({ data: this._i, error: null }).then(resolve, reject);
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
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
  storage?: any;
  constructor(seed?: Partial<Record<string, Row[]>>, opts?: { storage?: boolean; uploadFails?: boolean }) {
    this.tables = {
      borrower_identity_verifications: [],
      deal_events: [],
      deals: [],
      signed_documents: [],
      ...seed,
    };
    if (opts?.storage !== false) {
      const uploadFails = opts?.uploadFails ?? false;
      this.storage = {
        from: (_bucket: string) => ({
          upload: async (_path: string, _data: Buffer) =>
            uploadFails ? { error: { message: "upload_failed" } } : { error: null },
        }),
      };
    }
  }
  from(t: string) {
    return new Q(this, t);
  }
}

function fakeDocuseal(overrides?: Partial<DocusealClient>): DocusealClient {
  return {
    createDocusealSubmission: async () => ({
      id: 12345,
      status: "pending",
      submitters: [{ id: 1, slug: "sub_abc" }],
    }),
    fetchDocusealSubmission: async () => ({ id: 12345, status: "completed", submitters: [{ id: 1, slug: "sub_abc" }] }),
    downloadDocusealSignedPdf: async () => Buffer.from("pdf-bytes"),
    downloadDocusealAuditTrail: async () => Buffer.from("audit-bytes"),
    ...overrides,
  };
}

const DEAL_ID = "d1";
const OWNER_ID = "o1";

function withIal2(overrides?: Partial<Row>): Row[] {
  return [{ id: "v1", deal_id: DEAL_ID, ownership_entity_id: OWNER_ID, status: "completed", completed_at: "2026-01-01", ...overrides }];
}

test("requestSignature: no IAL2 -> IAL2_NOT_COMPLETED", async () => {
  const db = new FakeDb();
  const r = await requestSignature(
    { dealId: DEAL_ID, bankId: "b1", formCode: "FORM_1919", templateVersion: "v1", signerOwnershipEntityId: OWNER_ID, signerRole: "applicant", signerEmail: "j@d.com", signerName: "Jane Doe" },
    { sb: db as any, docuseal: fakeDocuseal() },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "IAL2_NOT_COMPLETED");
});

test("requestSignature: with IAL2 -> creates submission + writes esign.requested event", async () => {
  process.env.DOCUSEAL_TEMPLATE_1919 = "tmpl_1919";
  process.env.DOCUSEAL_BASE_URL_PUBLIC = "https://docuseal.example.com";
  const db = new FakeDb({ borrower_identity_verifications: withIal2() });
  const r = await requestSignature(
    { dealId: DEAL_ID, bankId: "b1", formCode: "FORM_1919", templateVersion: "v1", signerOwnershipEntityId: OWNER_ID, signerRole: "applicant", signerEmail: "j@d.com", signerName: "Jane Doe" },
    { sb: db as any, docuseal: fakeDocuseal() },
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.embedUrl.includes("sub_abc"));
  assert.ok(db.tables.deal_events.some((e) => e.kind === "esign.requested"));
});

test("handleDocusealWebhook: event_type=form.viewed -> ignored", async () => {
  const db = new FakeDb();
  const r = await handleDocusealWebhook({ event_type: "form.viewed", data: {} }, { sb: db as any, docuseal: fakeDocuseal() });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal((r as any).ignored, true);
});

test("handleDocusealWebhook: form.completed without IAL2 -> anomaly event + no signed_documents row", async () => {
  const db = new FakeDb();
  const r = await handleDocusealWebhook(
    { event_type: "form.completed", data: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}`, submission_id: 1 } },
    { sb: db as any, docuseal: fakeDocuseal() },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "IAL2_GATE_FAILED_AT_COMPLETION");
  assert.equal(db.tables.signed_documents.length, 0);
  assert.ok(db.tables.deal_events.some((e) => e.kind === "esign.completed_without_ial2_anomaly"));
});

test("handleDocusealWebhook: form.completed with IAL2 -> uploads PDF, writes signed_documents, fires esign.completed", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: withIal2(),
    deals: [{ id: DEAL_ID, bank_id: "b1" }],
  });
  const r = await handleDocusealWebhook(
    { event_type: "form.completed", data: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}`, submission_id: 1 } },
    { sb: db as any, docuseal: fakeDocuseal() },
  );
  assert.equal(r.ok, true);
  assert.equal(db.tables.signed_documents.length, 1);
  assert.ok(db.tables.deal_events.some((e) => e.kind === "esign.completed"));
});

test("handleDocusealWebhook: malformed external_id -> MALFORMED_EXTERNAL_ID", async () => {
  const db = new FakeDb();
  const r = await handleDocusealWebhook(
    { event_type: "form.completed", data: { external_id: "not-a-valid-format", submission_id: 1 } },
    { sb: db as any, docuseal: fakeDocuseal() },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "MALFORMED_EXTERNAL_ID");
});

test("signed_documents.expires_at: 90d for FORM_1919, 120d for FORM_4506C", async () => {
  const db1 = new FakeDb({ borrower_identity_verifications: withIal2(), deals: [{ id: DEAL_ID, bank_id: "b1" }] });
  await handleDocusealWebhook(
    { event_type: "form.completed", data: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}`, submission_id: 1 } },
    { sb: db1 as any, docuseal: fakeDocuseal() },
  );
  const doc1 = db1.tables.signed_documents[0];
  const days1 = (new Date(doc1.expires_at).getTime() - new Date(doc1.signature_completed_at).getTime()) / 86_400_000;
  assert.ok(Math.abs(days1 - 90) < 0.01);

  const db2 = new FakeDb({ borrower_identity_verifications: withIal2(), deals: [{ id: DEAL_ID, bank_id: "b1" }] });
  await handleDocusealWebhook(
    { event_type: "form.completed", data: { external_id: `deal:${DEAL_ID}:form:FORM_4506C:signer:${OWNER_ID}`, submission_id: 1 } },
    { sb: db2 as any, docuseal: fakeDocuseal() },
  );
  const doc2 = db2.tables.signed_documents[0];
  const days2 = (new Date(doc2.expires_at).getTime() - new Date(doc2.signature_completed_at).getTime()) / 86_400_000;
  assert.ok(Math.abs(days2 - 120) < 0.01);
});

test("handleDocusealWebhook: storage upload failure -> PDF_UPLOAD_FAILED + no signed_documents row", async () => {
  const db = new FakeDb(
    { borrower_identity_verifications: withIal2(), deals: [{ id: DEAL_ID, bank_id: "b1" }] },
    { uploadFails: true },
  );
  const r = await handleDocusealWebhook(
    { event_type: "form.completed", data: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}`, submission_id: 1 } },
    { sb: db as any, docuseal: fakeDocuseal() },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "PDF_UPLOAD_FAILED");
  assert.equal(db.tables.signed_documents.length, 0);
});
