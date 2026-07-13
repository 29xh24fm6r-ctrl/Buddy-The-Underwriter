import { test } from "node:test";
import assert from "node:assert/strict";
import { initiateKyc, handlePersonaWebhook, type PersonaClient } from "@/lib/identity/kyc/service";
import { requestSignature, handleDocusealWebhook, type DocusealClient } from "@/lib/esign/docuseal/service";

/**
 * SPEC S3 — integration test for the full IAL2 -> e-sign happy path
 * (mocked external services): initiate KYC -> Persona webhook completes ->
 * request signature (IAL2 gate passes) -> DocuSeal webhook completes ->
 * signed_documents row exists.
 */

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
  storage: any;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = {
      borrower_identity_verifications: [],
      ownership_entities: [],
      deal_events: [],
      deals: [],
      signed_documents: [],
      ...seed,
    };
    this.storage = {
      from: (_bucket: string) => ({
        upload: async (_path: string, _data: Buffer) => ({ error: null }),
      }),
    };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

test("full IAL2 -> e-sign happy path", async () => {
  process.env.DOCUSEAL_TEMPLATE_1919 = "tmpl_1919";
  process.env.DOCUSEAL_BASE_URL_PUBLIC = "https://docuseal.example.com";

  const DEAL_ID = "d1";
  const BANK_ID = "b1";
  const OWNER_ID = "o1";

  const db = new FakeDb({
    ownership_entities: [{ id: OWNER_ID, display_name: "Jane Doe" }],
    deals: [{ id: DEAL_ID, bank_id: BANK_ID }],
  });

  const persona: PersonaClient = {
    createPersonaInquiry: async () => ({ data: { id: "inq_1" } }),
    fetchPersonaInquiry: async (id) => ({
      data: { id, attributes: { status: "completed", "name-first": "Jane", "name-last": "Doe" } },
    }),
    generatePersonaOneTimeLink: async () => "https://withpersona.com/verify/otl_1",
  };

  // 1. Initiate KYC
  const kycResult = await initiateKyc(
    { dealId: DEAL_ID, bankId: BANK_ID, ownershipEntityId: OWNER_ID, initiatorUserId: "u1" },
    { sb: db as any, persona, templateId: "itmpl_1" },
  );
  assert.equal(kycResult.ok, true);

  // 2. Persona webhook completes the verification
  const webhookResult = await handlePersonaWebhook({ data: { id: "inq_1" } }, { sb: db as any, persona });
  assert.equal(webhookResult.ok, true);
  assert.equal(db.tables.borrower_identity_verifications[0].status, "completed");

  // 3. Request signature — IAL2 gate must now pass
  const docuseal: DocusealClient = {
    createDocusealSubmission: async () => ({ id: 99, status: "pending", submitters: [{ id: 1, slug: "sub_xyz" }] }),
    fetchDocusealSubmission: async () => ({ id: 99, status: "completed", submitters: [{ id: 1, slug: "sub_xyz" }] }),
    downloadDocusealSignedPdf: async () => Buffer.from("pdf-bytes"),
    downloadDocusealAuditTrail: async () => Buffer.from("audit-bytes"),
  };

  const sigResult = await requestSignature(
    {
      dealId: DEAL_ID,
      bankId: BANK_ID,
      formCode: "FORM_1919",
      templateVersion: "v1",
      signerOwnershipEntityId: OWNER_ID,
      signerRole: "applicant",
      signerEmail: "jane@example.com",
      signerName: "Jane Doe",
    },
    { sb: db as any, docuseal },
  );
  assert.equal(sigResult.ok, true);
  assert.ok(db.tables.deal_events.some((e) => e.kind === "esign.requested"));

  // 4. DocuSeal webhook completes the signature
  const esignWebhookResult = await handleDocusealWebhook(
    {
      event_type: "form.completed",
      data: { external_id: `deal:${DEAL_ID}:form:FORM_1919:signer:${OWNER_ID}`, submission_id: 99 },
    },
    { sb: db as any, docuseal },
  );
  assert.equal(esignWebhookResult.ok, true);

  // 5. signed_documents row exists
  assert.equal(db.tables.signed_documents.length, 1);
  const signedDoc = db.tables.signed_documents[0];
  assert.equal(signedDoc.deal_id, DEAL_ID);
  assert.equal(signedDoc.form_code, "FORM_1919");
  assert.equal(signedDoc.signer_ownership_entity_id, OWNER_ID);
  assert.ok(signedDoc.identity_verification_id);
  assert.ok(db.tables.deal_events.some((e) => e.kind === "esign.completed"));
});
