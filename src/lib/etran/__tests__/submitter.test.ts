import { test } from "node:test";
import assert from "node:assert/strict";
import { submitToSba, type GenerateEtranXmlFn, type GetEtranCredentialsFn, type PostToSbaFn } from "@/lib/etran/submitter";

// submitter.ts is deliberately free of "server-only" (see its own docstring)
// so it can be imported directly here, unlike etranHttpClient.ts/generator.ts's
// real vendor-calling siblings.

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: "eq" | "gt"; k: string; v: any }> = [];
  _insertRows: Row[] | null = null;
  _insertError: { code: string; message: string } | null = null;
  _updateData: Row | null = null;
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_cols?: string) {
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ t: "eq", k, v });
    return this;
  }
  gt(k: string, v: any) {
    this.filters.push({ t: "gt", k, v });
    return this;
  }
  insert(payload: Row | Row[]) {
    const rows = Array.isArray(payload) ? payload : [payload];
    const uniqueCols = this.db.uniqueCols[this.table] ?? [];
    for (const col of uniqueCols) {
      for (const r of rows) {
        if (r[col] !== undefined && (this.db.tables[this.table] ?? []).some((existing) => existing[col] === r[col])) {
          this._insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
          return this;
        }
      }
    }
    const withIds = rows.map((r) => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...withIds);
    this._insertRows = withIds;
    return this;
  }
  update(u: Row) {
    this._updateData = u;
    return this;
  }
  single() {
    if (this._insertError) return Promise.resolve({ data: null, error: this._insertError });
    if (this._insertRows) return Promise.resolve({ data: this._insertRows[0] ?? null, error: null });
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(resolve: any, reject?: any) {
    if (this._updateData) {
      for (const r of this.rows()) Object.assign(r, this._updateData);
      return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
    }
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
  private rows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "eq") rows = rows.filter((r) => r[f.k] === f.v);
      else if (f.t === "gt") rows = rows.filter((r) => r[f.k] > f.v);
    }
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  uniqueCols: Record<string, string[]>;
  storage: any;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = { sba_etran_submissions: [], signed_documents: [], deal_events: [], ...seed };
    this.uniqueCols = { sba_etran_submissions: ["idempotency_key"] };
    this.storage = { from: (_bucket: string) => ({ upload: async () => ({ error: null }) }) };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

const REQUIRED_FORMS = ["FORM_1919", "FORM_413", "FORM_4506C"];
const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

function signedDocsRows(dealId: string): Row[] {
  return REQUIRED_FORMS.map((form_code) => ({ deal_id: dealId, form_code, expires_at: FUTURE }));
}

function readyXml(): GenerateEtranXmlFn {
  return async () => ({ xml: "<ETran>ok</ETran>", validation_errors: [], ready_for_review: true });
}

function credsFor(environment: "sandbox" | "production"): GetEtranCredentialsFn {
  return async () => ({
    sba_lender_id: "LID-1",
    sba_service_center: "SC-1",
    client_cert_pem: "-----BEGIN CERTIFICATE-----",
    client_key_pem: "-----BEGIN PRIVATE KEY-----",
    endpoint_environment: environment,
  });
}

function acceptingPost(): PostToSbaFn {
  return async () => ({ accepted: true, body: "<Response><Status>Accepted</Status><ApplicationNumber>SBA-1001</ApplicationNumber></Response>" });
}

const BASE_ARGS = { dealId: "d1", bankId: "b1", approvedByUserId: "u1" };
const ENDPOINTS = { sandboxEndpoint: "https://sandbox.example/etran", productionEndpoint: "https://prod.example/etran" };

test("submitToSba: VALIDATION_FAILED when generateXml reports not ready", async () => {
  const db = new FakeDb({ signed_documents: signedDocsRows("d1") });
  const result = await submitToSba(BASE_ARGS, {
    sb: db as any,
    generateXml: async () => ({ xml: "", validation_errors: ["Missing EIN"], ready_for_review: false }),
    getCredentials: credsFor("sandbox"),
    postToSba: acceptingPost(),
    ...ENDPOINTS,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "VALIDATION_FAILED");
    assert.match(result.details ?? "", /Missing EIN/);
  }
});

test("submitToSba: REQUIRED_SIGNED_FORMS_MISSING when no signed_documents rows present", async () => {
  const db = new FakeDb(); // no signed_documents seeded
  const result = await submitToSba(BASE_ARGS, {
    sb: db as any,
    generateXml: readyXml(),
    getCredentials: credsFor("sandbox"),
    postToSba: acceptingPost(),
    ...ENDPOINTS,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "REQUIRED_SIGNED_FORMS_MISSING");
    assert.match(result.details ?? "", /FORM_1919/);
  }
});

test("submitToSba: ETRAN_CREDENTIALS_MISSING when getCredentials returns null", async () => {
  const db = new FakeDb({ signed_documents: signedDocsRows("d1") });
  const result = await submitToSba(BASE_ARGS, {
    sb: db as any,
    generateXml: readyXml(),
    getCredentials: async () => null,
    postToSba: acceptingPost(),
    ...ENDPOINTS,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "ETRAN_CREDENTIALS_MISSING");
});

test("submitToSba: SBA accepts -> ok:true with application number, submission row updated to accepted", async () => {
  const db = new FakeDb({ signed_documents: signedDocsRows("d1") });
  const result = await submitToSba(BASE_ARGS, {
    sb: db as any,
    generateXml: readyXml(),
    getCredentials: credsFor("sandbox"),
    postToSba: acceptingPost(),
    ...ENDPOINTS,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.sba_application_number, "SBA-1001");
    const row = db.tables.sba_etran_submissions.find((r) => r.id === result.submission_id);
    assert.equal(row?.status, "accepted");
    assert.equal(row?.approved_by_user_id, "u1");
  }
  assert.ok(db.tables.deal_events.some((e) => e.kind === "sba_application_submitted"));
});

test("submitToSba: SBA rejects -> ok:false SBA_REJECTED, submission row updated to rejected", async () => {
  const db = new FakeDb({ signed_documents: signedDocsRows("d1") });
  const result = await submitToSba(BASE_ARGS, {
    sb: db as any,
    generateXml: readyXml(),
    getCredentials: credsFor("sandbox"),
    postToSba: async () => ({ accepted: false, body: "<Response><RejectionReason>NAICS mismatch</RejectionReason></Response>", rejectionReason: "NAICS mismatch" }),
    ...ENDPOINTS,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "SBA_REJECTED");
    assert.equal(result.details, "NAICS mismatch");
  }
  assert.equal(db.tables.sba_etran_submissions[0].status, "rejected");
  assert.ok(db.tables.deal_events.some((e) => e.kind === "sba_application_rejected"));
});

test("submitToSba: network error -> ok:false NETWORK_ERROR, submission row marked error", async () => {
  const db = new FakeDb({ signed_documents: signedDocsRows("d1") });
  const result = await submitToSba(BASE_ARGS, {
    sb: db as any,
    generateXml: readyXml(),
    getCredentials: credsFor("sandbox"),
    postToSba: async () => {
      throw new Error("ECONNRESET");
    },
    ...ENDPOINTS,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "NETWORK_ERROR");
    assert.match(result.details ?? "", /ECONNRESET/);
  }
  assert.equal(db.tables.sba_etran_submissions[0].status, "error");
});

test("submitToSba: idempotent retry with identical xml replays the existing accepted submission instead of re-POSTing", async () => {
  const db = new FakeDb({ signed_documents: signedDocsRows("d1") });
  let postCount = 0;
  const postToSba: PostToSbaFn = async () => {
    postCount += 1;
    return { accepted: true, body: "<Response><Status>Accepted</Status><ApplicationNumber>SBA-2002</ApplicationNumber></Response>" };
  };

  const first = await submitToSba(BASE_ARGS, { sb: db as any, generateXml: readyXml(), getCredentials: credsFor("sandbox"), postToSba, ...ENDPOINTS });
  const second = await submitToSba(BASE_ARGS, { sb: db as any, generateXml: readyXml(), getCredentials: credsFor("sandbox"), postToSba, ...ENDPOINTS });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.sba_application_number, second.sba_application_number);
  }
  assert.equal(postCount, 1, "second call must not re-POST to SBA");
  assert.equal(db.tables.sba_etran_submissions.length, 1, "no duplicate submission row created");
});

test("submitToSba: sandbox credentials route to sandboxEndpoint, production credentials route to productionEndpoint", async () => {
  const db1 = new FakeDb({ signed_documents: signedDocsRows("d1") });
  let calledEndpoint = "";
  const captureEndpoint: PostToSbaFn = async (args) => {
    calledEndpoint = args.endpoint;
    return { accepted: true, body: "<Response><Status>Accepted</Status><ApplicationNumber>SBA-3003</ApplicationNumber></Response>" };
  };
  await submitToSba(BASE_ARGS, { sb: db1 as any, generateXml: readyXml(), getCredentials: credsFor("sandbox"), postToSba: captureEndpoint, ...ENDPOINTS });
  assert.equal(calledEndpoint, ENDPOINTS.sandboxEndpoint);

  const db2 = new FakeDb({ signed_documents: signedDocsRows("d1") });
  await submitToSba(BASE_ARGS, { sb: db2 as any, generateXml: readyXml(), getCredentials: credsFor("production"), postToSba: captureEndpoint, ...ENDPOINTS });
  assert.equal(calledEndpoint, ENDPOINTS.productionEndpoint);
});

test("submitToSba: defense-in-depth — empty approvedByUserId is rejected even if a caller somehow bypasses the type system", async () => {
  const db = new FakeDb({ signed_documents: signedDocsRows("d1") });
  const result = await submitToSba(
    { dealId: "d1", bankId: "b1", approvedByUserId: "" },
    { sb: db as any, generateXml: readyXml(), getCredentials: credsFor("sandbox"), postToSba: acceptingPost(), ...ENDPOINTS },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "VALIDATION_FAILED");
});
