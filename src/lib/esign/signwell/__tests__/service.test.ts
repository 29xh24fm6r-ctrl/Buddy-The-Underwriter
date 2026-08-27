import { test } from "node:test";
import assert from "node:assert/strict";
import { requestSignature, handleSignwellWebhook, type SignwellClient } from "@/lib/esign/signwell/service";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: string; k: string; v: any }> = [];
  _u: Row | null = null;
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
  update(u: Row) {
    this._u = u;
    return this;
  }
  single(): Promise<{ data: any; error: any }> {
    if (this._i) return Promise.resolve({ data: this._i[0], error: null });
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this._u) {
      if (this.table === "signing_requests" && this.db.failSigningRequestUpdate) {
        return Promise.resolve({ data: null, error: { message: "write_rejected" } });
      }
      this.applyUpdate();
      return Promise.resolve({ data: this.rows()[0], error: null });
    }
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(resolve: any, reject?: any) {
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
  storage?: any;
  failSigningRequestUpdate: boolean;
  constructor(seed?: Partial<Record<string, Row[]>>, opts?: { storage?: boolean; uploadFails?: boolean; signingRequestUpdateFails?: boolean }) {
    this.failSigningRequestUpdate = opts?.signingRequestUpdateFails ?? false;
    this.tables = {
      borrower_identity_verifications: [],
      deal_events: [],
      deals: [],
      signed_documents: [],
      signing_requests: [],
      ...seed,
    };
    if (opts?.storage !== false) {
      const uploadFails = opts?.uploadFails ?? false;
      const uploads: Array<{ bucket: string; path: string; opts: any }> = [];
      this.storage = {
        uploads,
        from: (bucket: string) => ({
          upload: async (path: string, _data: Buffer, uploadOpts?: any) => {
            uploads.push({ bucket, path, opts: uploadOpts });
            return uploadFails ? { error: { message: "upload_failed" } } : { error: null };
          },
        }),
      };
    }
  }
  from(t: string) {
    return new Q(this, t);
  }
}

function fakeSignwell(overrides?: Partial<SignwellClient>): SignwellClient {
  return {
    createSignwellDocumentFromFile: async () => ({
      id: 12345,
      status: "pending",
      recipients: [{ id: "1", embedded_signing_url: "https://www.signwell.com/embed/sub_abc" }],
    }),
    deleteSignwellDocument: async () => undefined,
    fetchSignwellDocument: async (documentId) => ({
      id: documentId,
      status: "completed",
      metadata: { external_id: "deal:d1:form:FORM_1919:signer:o1" },
      recipients: [{ id: "1", email: "j@d.com", embedded_signing_url: "https://www.signwell.com/embed/sub_abc" }],
    }),
    downloadSignwellCompletedPdf: async () => Buffer.from("pdf-bytes"),
    ...overrides,
  };
}

const fakeRenderFilledPdf = async () => ({ ok: true as const, pdfBytes: Buffer.from("filled-pdf-bytes") });

const DEAL_ID = "d1";
const OWNER_ID = "o1";

function withIal2(overrides?: Partial<Row>): Row[] {
  return [{ id: "v1", deal_id: DEAL_ID, ownership_entity_id: OWNER_ID, status: "completed", completed_at: "2026-01-01", ...overrides }];
}

function withSigningRequest(formCode = "FORM_1919", overrides?: Partial<Row>): Row[] {
  return [{
    id: "sr1",
    deal_id: DEAL_ID,
    bank_id: "b1",
    form_code: formCode,
    signer_ownership_entity_id: OWNER_ID,
    signer_role: "guarantor",
    recipient_email: "j@d.com",
    recipient_name: "Jane Doe",
    signwell_document_id: "1",
    status: "pending",
    created_at: "2026-01-02T03:04:05.000Z",
    metadata: { template_version: "v7", identity_verification_id: "v1" },
    ...overrides,
  }];
}

test("requestSignature: no IAL2 -> IAL2_NOT_COMPLETED", async () => {
  const db = new FakeDb();
  const r = await requestSignature(
    { dealId: DEAL_ID, bankId: "b1", formCode: "FORM_1919", templateVersion: "v1", signerOwnershipEntityId: OWNER_ID, signerRole: "applicant", signerEmail: "j@d.com", signerName: "Jane Doe" },
    { sb: db as any, signwell: fakeSignwell(), renderFilledPdf: fakeRenderFilledPdf },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "IAL2_NOT_COMPLETED");
});

test("requestSignature: with IAL2 -> creates document + writes esign.requested event + signing_requests row", async () => {
  const db = new FakeDb({ borrower_identity_verifications: withIal2() });
  const r = await requestSignature(
    { dealId: DEAL_ID, bankId: "b1", formCode: "FORM_1919", templateVersion: "v1", signerOwnershipEntityId: OWNER_ID, signerRole: "applicant", signerEmail: "j@d.com", signerName: "Jane Doe" },
    { sb: db as any, signwell: fakeSignwell(), renderFilledPdf: fakeRenderFilledPdf },
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.embedUrl.includes("sub_abc"));
  assert.ok(db.tables.deal_events.some((e) => e.kind === "esign.requested"));
  assert.equal(db.tables.signing_requests?.length, 1);
  assert.equal(db.tables.signing_requests?.[0].signwell_document_id, "12345");
  assert.deepEqual(db.tables.signing_requests?.[0].metadata, {
    template_version: "v1",
    identity_verification_id: "v1",
  });
});

test("requestSignature: missing provider signing URL cancels the untracked document", async () => {
  const deleted: string[] = [];
  const db = new FakeDb({ borrower_identity_verifications: withIal2() });
  const r = await requestSignature(
    { dealId: DEAL_ID, bankId: "b1", formCode: "FORM_1919", templateVersion: "v1", signerOwnershipEntityId: OWNER_ID, signerRole: "applicant", signerEmail: "j@d.com", signerName: "Jane Doe" },
    {
      sb: db as any,
      signwell: fakeSignwell({
        createSignwellDocumentFromFile: async () => ({ id: 456, status: "pending", recipients: [] }),
        deleteSignwellDocument: async (documentId) => { deleted.push(documentId); },
      }),
      renderFilledPdf: fakeRenderFilledPdf,
    },
  );

  assert.deepEqual(r, { ok: false, reason: "SUBMISSION_FAILED", detail: "signwell_response_missing_signing_url" });
  assert.deepEqual(deleted, ["456"]);
  assert.equal(db.tables.signing_requests.length, 0);
  assert.equal(db.tables.deal_events.length, 0);
});

test("requestSignature: tracking failure cancels the provider document before returning failure", async () => {
  const deleted: string[] = [];
  const db = new FakeDb({ borrower_identity_verifications: withIal2() });
  const sb = {
    storage: db.storage,
    from: (table: string) => table === "signing_requests"
      ? { insert: async () => ({ error: { message: "database_unavailable" } }) }
      : db.from(table),
  };
  const r = await requestSignature(
    { dealId: DEAL_ID, bankId: "b1", formCode: "FORM_1919", templateVersion: "v1", signerOwnershipEntityId: OWNER_ID, signerRole: "applicant", signerEmail: "j@d.com", signerName: "Jane Doe" },
    {
      sb: sb as any,
      signwell: fakeSignwell({
        deleteSignwellDocument: async (documentId) => { deleted.push(documentId); },
      }),
      renderFilledPdf: fakeRenderFilledPdf,
    },
  );

  assert.deepEqual(r, {
    ok: false,
    reason: "SUBMISSION_FAILED",
    detail: "signing_request_tracking_failed:database_unavailable",
  });
  assert.deepEqual(deleted, ["12345"]);
  assert.equal(db.tables.deal_events.length, 0);
});

test("requestSignature: provider cleanup failure is explicit and keeps the document identity in server logs", async () => {
  const db = new FakeDb({ borrower_identity_verifications: withIal2() });
  const sb = {
    storage: db.storage,
    from: (table: string) => table === "signing_requests"
      ? { insert: async () => { throw new Error("insert_threw"); } }
      : db.from(table),
  };
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    const r = await requestSignature(
      { dealId: DEAL_ID, bankId: "b1", formCode: "FORM_1919", templateVersion: "v1", signerOwnershipEntityId: OWNER_ID, signerRole: "applicant", signerEmail: "j@d.com", signerName: "Jane Doe" },
      {
        sb: sb as any,
        signwell: fakeSignwell({
          deleteSignwellDocument: async () => { throw new Error("delete_failed"); },
        }),
        renderFilledPdf: fakeRenderFilledPdf,
      },
    );

    assert.deepEqual(r, {
      ok: false,
      reason: "SUBMISSION_FAILED",
      detail: "signing_request_tracking_failed:insert_threw:provider_cleanup_failed",
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /failed to cancel untracked SignWell document/);
  assert.deepEqual(errors[0][1], { documentId: "12345", error: "delete_failed" });
  assert.equal(db.tables.deal_events.length, 0);
});

test("requestSignature: pdf render fails -> SUBMISSION_FAILED, no document created", async () => {
  const db = new FakeDb({ borrower_identity_verifications: withIal2() });
  const r = await requestSignature(
    { dealId: DEAL_ID, bankId: "b1", formCode: "FORM_1919", templateVersion: "v1", signerOwnershipEntityId: OWNER_ID, signerRole: "applicant", signerEmail: "j@d.com", signerName: "Jane Doe" },
    { sb: db as any, signwell: fakeSignwell(), renderFilledPdf: async () => ({ ok: false, reason: "TEMPLATE_NOT_AVAILABLE" }) },
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "SUBMISSION_FAILED");
    assert.match(r.detail ?? "", /TEMPLATE_NOT_AVAILABLE/);
  }
});

test("handleSignwellWebhook: event.type=document_viewed -> ignored", async () => {
  const db = new FakeDb();
  const r = await handleSignwellWebhook(
    { event: { type: "document_viewed" }, data: { object: {} } },
    { sb: db as any, signwell: fakeSignwell() },
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal((r as any).ignored, true);
});

test("handleSignwellWebhook: durable request without IAL2 -> anomaly event + no signed_documents row", async () => {
  const db = new FakeDb({ signing_requests: withSigningRequest() });
  const r = await handleSignwellWebhook(
    { event: { type: "document_completed" }, data: { object: { id: 1, metadata: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}` } } } },
    { sb: db as any, signwell: fakeSignwell() },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "IAL2_GATE_FAILED_AT_COMPLETION");
  assert.equal(db.tables.signed_documents.length, 0);
  assert.ok(db.tables.deal_events.some((e) => e.kind === "esign.completed_without_ial2_anomaly"));
});

test("handleSignwellWebhook: document_completed with IAL2 -> uploads PDF, writes signed_documents, fires esign.completed", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: withIal2(),
    deals: [{ id: DEAL_ID, bank_id: "b1" }],
    signing_requests: withSigningRequest(),
  });
  const r = await handleSignwellWebhook(
    { event: { type: "document_completed", time: "2026-01-03T04:05:06.000Z" }, data: { object: { id: 1, metadata: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}` } } } },
    { sb: db as any, signwell: fakeSignwell() },
  );
  assert.equal(r.ok, true);
  assert.equal(db.tables.signed_documents.length, 1);
  assert.equal(db.tables.signed_documents[0].esign_provider, "signwell");
  assert.equal(db.tables.signed_documents[0].audit_trail_storage_path, null);
  assert.equal(db.tables.signed_documents[0].template_version, "v7");
  assert.equal(db.tables.signed_documents[0].signer_role, "guarantor");
  assert.equal(db.tables.signed_documents[0].signature_request_sent_at, "2026-01-02T03:04:05.000Z");
  assert.equal(db.tables.signed_documents[0].signature_completed_at, "2026-01-03T04:05:06.000Z");
  assert.equal(db.storage.uploads[0].opts.upsert, true);
  assert.ok(db.tables.deal_events.some((e) => e.kind === "esign.completed"));
});

test("handleSignwellWebhook: malformed external_id -> MALFORMED_EXTERNAL_ID", async () => {
  const db = new FakeDb();
  const r = await handleSignwellWebhook(
    { event: { type: "document_completed" }, data: { object: { id: 1, metadata: { external_id: "not-a-valid-format" } } } },
    { sb: db as any, signwell: fakeSignwell() },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "MALFORMED_EXTERNAL_ID");
});

test("signed_documents.expires_at: 90d for FORM_1919, 120d for FORM_4506C", async () => {
  const db1 = new FakeDb({ borrower_identity_verifications: withIal2(), deals: [{ id: DEAL_ID, bank_id: "b1" }], signing_requests: withSigningRequest() });
  await handleSignwellWebhook(
    { event: { type: "document_completed" }, data: { object: { id: 1, metadata: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}` } } } },
    { sb: db1 as any, signwell: fakeSignwell() },
  );
  const doc1 = db1.tables.signed_documents[0];
  const days1 = (new Date(doc1.expires_at).getTime() - new Date(doc1.signature_completed_at).getTime()) / 86_400_000;
  assert.ok(Math.abs(days1 - 90) < 0.01);

  const db2 = new FakeDb({ borrower_identity_verifications: withIal2(), deals: [{ id: DEAL_ID, bank_id: "b1" }], signing_requests: withSigningRequest("FORM_4506C") });
  await handleSignwellWebhook(
    { event: { type: "document_completed" }, data: { object: { id: 1, metadata: { external_id: `deal:${DEAL_ID}:form:FORM_4506C:signer:${OWNER_ID}` } } } },
    {
      sb: db2 as any,
      signwell: fakeSignwell({
        fetchSignwellDocument: async (documentId) => ({
          id: documentId,
          status: "Completed",
          metadata: { external_id: `deal:${DEAL_ID}:form:FORM_4506C:signer:${OWNER_ID}` },
          recipients: [{ id: "1", email: "j@d.com" }],
        }),
      }),
    },
  );
  const doc2 = db2.tables.signed_documents[0];
  const days2 = (new Date(doc2.expires_at).getTime() - new Date(doc2.signature_completed_at).getTime()) / 86_400_000;
  assert.ok(Math.abs(days2 - 120) < 0.01);
});

test("handleSignwellWebhook: storage upload failure -> PDF_UPLOAD_FAILED + no signed_documents row", async () => {
  const db = new FakeDb(
    { borrower_identity_verifications: withIal2(), deals: [{ id: DEAL_ID, bank_id: "b1" }], signing_requests: withSigningRequest() },
    { uploadFails: true },
  );
  const r = await handleSignwellWebhook(
    { event: { type: "document_completed" }, data: { object: { id: 1, metadata: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}` } } } },
    { sb: db as any, signwell: fakeSignwell() },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "PDF_UPLOAD_FAILED");
  assert.equal(db.tables.signed_documents.length, 0);
});


test("handleSignwellWebhook: duplicate completion returns existing record without provider or storage work", async () => {
  let fetches = 0;
  let downloads = 0;
  const db = new FakeDb({
    signed_documents: [{ id: "sd-existing", esign_document_id: "1" }],
  });
  const r = await handleSignwellWebhook(
    { event: { type: "document_completed", time: 1787734800 }, data: { object: { id: 1, metadata: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}` } } } },
    {
      sb: db as any,
      signwell: fakeSignwell({
        fetchSignwellDocument: async () => {
          fetches += 1;
          throw new Error("should_not_fetch");
        },
        downloadSignwellCompletedPdf: async () => {
          downloads += 1;
          throw new Error("should_not_download");
        },
      }),
    },
  );
  assert.deepEqual(r, { ok: true, signedDocumentId: "sd-existing", reused: true });
  assert.equal(fetches, 0);
  assert.equal(downloads, 0);
  assert.equal(db.storage.uploads.length, 0);
});

test("handleSignwellWebhook: missing durable signing request fails closed", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: withIal2(),
    deals: [{ id: DEAL_ID, bank_id: "b1" }],
  });
  const r = await handleSignwellWebhook(
    { event: { type: "document_completed" }, data: { object: { id: 1, metadata: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}` } } } },
    { sb: db as any, signwell: fakeSignwell() },
  );
  assert.deepEqual(r, { ok: false, reason: "SIGNING_REQUEST_NOT_FOUND" });
  assert.equal(db.tables.signed_documents.length, 0);
  assert.equal(db.storage.uploads.length, 0);
});

test("handleSignwellWebhook: unknown provider document cannot trigger a deal-scoped IAL2 anomaly", async () => {
  const db = new FakeDb();
  const r = await handleSignwellWebhook(
    {
      event: { type: "document_completed" },
      data: { object: { id: 1, metadata: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}` } } },
    },
    { sb: db as any, signwell: fakeSignwell() },
  );

  assert.deepEqual(r, { ok: false, reason: "SIGNING_REQUEST_NOT_FOUND" });
  assert.equal(db.tables.deal_events.length, 0);
  assert.equal(db.tables.signed_documents.length, 0);
  assert.equal(db.storage.uploads.length, 0);
});

test("handleSignwellWebhook: provider recipient mismatch fails closed", async () => {
  const db = new FakeDb({
    borrower_identity_verifications: withIal2(),
    deals: [{ id: DEAL_ID, bank_id: "b1" }],
    signing_requests: withSigningRequest(),
  });
  const r = await handleSignwellWebhook(
    { event: { type: "document_completed" }, data: { object: { id: 1, metadata: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}` } } } },
    {
      sb: db as any,
      signwell: fakeSignwell({
        fetchSignwellDocument: async () => ({
          id: 1,
          status: "completed",
          metadata: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}` },
          recipients: [{ id: "1", email: "different@example.com" }],
        }),
      }),
    },
  );
  assert.deepEqual(r, { ok: false, reason: "SIGNER_MISMATCH", detail: "recipient_email_mismatch" });
  assert.equal(db.tables.signed_documents.length, 0);
  assert.equal(db.storage.uploads.length, 0);
});

const canonicalExternalId = `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}`;

for (const scenario of [
  {
    name: "provider document id differs from the webhook lookup id",
    document: {
      id: 2,
      status: "Completed",
      metadata: { external_id: canonicalExternalId },
      recipients: [{ id: "1", email: "j@d.com" }],
    },
    expected: { ok: false as const, reason: "PROVIDER_DOCUMENT_MISMATCH" as const, detail: "document_id_mismatch" },
  },
  {
    name: "provider document is not terminally completed",
    document: {
      id: 1,
      status: "Pending",
      metadata: { external_id: canonicalExternalId },
      recipients: [{ id: "1", email: "j@d.com" }],
    },
    expected: { ok: false as const, reason: "PROVIDER_DOCUMENT_MISMATCH" as const, detail: "status_not_completed:pending" },
  },
  {
    name: "provider canonical external id differs from the webhook object",
    document: {
      id: 1,
      status: "Completed",
      metadata: { external_id: "deal:other:form:FORM_1919:signer:o1" },
      recipients: [{ id: "1", email: "j@d.com" }],
    },
    expected: { ok: false as const, reason: "PROVIDER_DOCUMENT_MISMATCH" as const, detail: "external_id_mismatch" },
  },
  {
    name: "provider canonical recipient email is missing",
    document: {
      id: 1,
      status: "Completed",
      metadata: { external_id: canonicalExternalId },
      recipients: [{ id: "1" }],
    },
    expected: { ok: false as const, reason: "SIGNER_MISMATCH" as const, detail: "provider_email_missing" },
  },
]) {
  test(`handleSignwellWebhook: ${scenario.name} fails closed before PDF or storage work`, async () => {
    let downloads = 0;
    const db = new FakeDb({
      borrower_identity_verifications: withIal2(),
      deals: [{ id: DEAL_ID, bank_id: "b1" }],
      signing_requests: withSigningRequest(),
    });
    const r = await handleSignwellWebhook(
      {
        event: { type: "document_completed" },
        data: { object: { id: 1, metadata: { external_id: canonicalExternalId } } },
      },
      {
        sb: db as any,
        signwell: fakeSignwell({
          fetchSignwellDocument: async () => scenario.document,
          downloadSignwellCompletedPdf: async () => {
            downloads += 1;
            return Buffer.from("should-not-download");
          },
        }),
      },
    );

    assert.deepEqual(r, scenario.expected);
    assert.equal(downloads, 0);
    assert.equal(db.storage.uploads.length, 0);
    assert.equal(db.tables.signed_documents.length, 0);
  });
}



for (const terminal of [
  ["document_expired", "Expired"],
  ["document_canceled", "Canceled"],
  ["document_declined", "Declined"],
  ["document_bounced", "Bounced"],
  ["document_error", "Error"],
] as const) {
  test(`handleSignwellWebhook: ${terminal[0]} durably retires the signing request`, async () => {
    const payload = {
      event: { type: terminal[0], time: "2026-08-27T04:00:00.000Z" },
      data: { object: { id: 1, metadata: { external_id: canonicalExternalId } } },
    };
    const db = new FakeDb({ signing_requests: withSigningRequest() });
    const r = await handleSignwellWebhook(
      payload,
      {
        sb: db as any,
        signwell: fakeSignwell({
          fetchSignwellDocument: async () => ({
            id: 1,
            status: terminal[1],
            metadata: { external_id: canonicalExternalId },
            recipients: [{ id: "1", email: "j@d.com" }],
          }),
        }),
      },
    );

    assert.deepEqual(r, { ok: true, terminalStatus: terminal[1] });
    assert.equal(db.tables.signing_requests[0].status, terminal[1]);
    assert.deepEqual(db.tables.signing_requests[0].raw_last_event, payload);
    assert.ok(
      db.tables.deal_events.some(
        (event) => event.kind === `esign.${terminal[1].toLowerCase()}`,
      ),
    );
    assert.equal(db.tables.signed_documents.length, 0);
    assert.equal(db.storage.uploads.length, 0);
  });
}

test("handleSignwellWebhook: terminal webhook cannot override a different canonical provider status", async () => {
  const db = new FakeDb({ signing_requests: withSigningRequest() });
  const r = await handleSignwellWebhook(
    {
      event: { type: "document_declined" },
      data: { object: { id: 1, metadata: { external_id: canonicalExternalId } } },
    },
    {
      sb: db as any,
      signwell: fakeSignwell({
        fetchSignwellDocument: async () => ({
          id: 1,
          status: "Pending",
          metadata: { external_id: canonicalExternalId },
          recipients: [{ id: "1", email: "j@d.com" }],
        }),
      }),
    },
  );

  assert.deepEqual(r, {
    ok: false,
    reason: "PROVIDER_DOCUMENT_MISMATCH",
    detail: "status_not_declined:pending",
  });
  assert.equal(db.tables.signing_requests[0].status, "pending");
  assert.equal(db.tables.deal_events.length, 0);
});

test("handleSignwellWebhook: terminal state write failure remains retryable", async () => {
  const db = new FakeDb(
    { signing_requests: withSigningRequest() },
    { signingRequestUpdateFails: true },
  );
  const r = await handleSignwellWebhook(
    {
      event: { type: "document_expired" },
      data: { object: { id: 1, metadata: { external_id: canonicalExternalId } } },
    },
    {
      sb: db as any,
      signwell: fakeSignwell({
        fetchSignwellDocument: async () => ({
          id: 1,
          status: "Expired",
          metadata: { external_id: canonicalExternalId },
          recipients: [{ id: "1", email: "j@d.com" }],
        }),
      }),
    },
  );

  assert.deepEqual(r, {
    ok: false,
    reason: "SIGNING_REQUEST_STATUS_UPDATE_FAILED",
    detail: "write_rejected",
  });
  assert.equal(db.tables.signing_requests[0].status, "pending");
  assert.equal(db.tables.deal_events.length, 0);
});
