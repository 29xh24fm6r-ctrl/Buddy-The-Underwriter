import { test } from "node:test";
import assert from "node:assert/strict";
import { initiateKyc, handleDiditWebhook, hasValidIal2 } from "@/lib/identity/kyc/service";
import { handleSignwellWebhook } from "@/lib/esign/signwell/service";
import { mockCreateDiditSession, mockFetchDiditSession, mockGetDiditSessionDecision } from "@/lib/identity/kyc/mockDidit";
import { mockRequestSignature } from "@/lib/esign/signwell/mockService";
import {
  mockCreateSignwellDocumentFromFile,
  mockFetchSignwellDocument,
  mockDownloadSignwellCompletedPdf,
} from "@/lib/esign/signwell/mockClient";

// Integration test for the mock-vendor harness: exercises the REAL
// initiateKyc/handleDiditWebhook/hasValidIal2/handleSignwellWebhook
// functions chained together with mock vendor clients — the same call
// sequence the borrower-actions/[action] route drives, in the order a
// real borrower would actually trigger it (verify identity, gate checks
// signing, sign, gate re-checks at completion). Unlike the per-module
// unit tests, this catches integration bugs between the pieces.

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
  storageUploads: Array<{ bucket: string; path: string }> = [];
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = {
      borrower_identity_verifications: [],
      ownership_entities: [],
      deal_events: [],
      signed_documents: [],
      deals: [],
      ...seed,
    };
  }
  from(t: string) {
    return new Q(this, t);
  }
  get storage() {
    return {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          this.storageUploads.push({ bucket, path });
          return { error: null };
        },
      }),
    };
  }
}

test("full mock-vendor chain: verify identity -> sign -> both complete, with real gates enforced throughout", async () => {
  const db = new FakeDb({
    ownership_entities: [{ id: "owner-1", display_name: "Jane Doe" }],
    deals: [{ id: "deal-1", bank_id: "bank-brokerage" }],
  });

  const mockDidit = {
    createDiditSession: mockCreateDiditSession,
    fetchDiditSession: mockFetchDiditSession,
    getDiditSessionDecision: mockGetDiditSessionDecision,
  };

  // 1. Initiate KYC — mirrors postKyc.
  const initResult = await initiateKyc(
    {
      dealId: "deal-1",
      bankId: "bank-brokerage",
      ownershipEntityId: "owner-1",
      initiatorUserId: "brokerage_borrower_session:deal-1",
      vendorOverride: "mock_didit",
    },
    { sb: db as any, didit: mockDidit, workflowId: "mock-workflow-ial2" },
  );
  assert.equal(initResult.ok, true);
  if (!initResult.ok) return;
  assert.equal(initResult.verification.vendor, "mock_didit");
  assert.ok(initResult.sessionUrl?.includes("mock-complete-kyc"));

  // Before completion, signing must be blocked — the IAL2 gate is real,
  // not mocked away.
  const preSignAttempt = await mockRequestSignature(
    {
      dealId: "deal-1",
      bankId: "bank-brokerage",
      formCode: "SBA_1919",
      templateVersion: "v1",
      signerOwnershipEntityId: "owner-1",
      signerRole: "applicant",
      signerEmail: "jane@example.com",
      signerName: "Jane Doe",
    },
    { sb: db as any },
  );
  assert.deepEqual(preSignAttempt, { ok: false, reason: "IAL2_NOT_COMPLETED" });

  // 2. Complete KYC — mirrors getMockCompleteKyc, calling the REAL
  // handleDiditWebhook (not a mock of the webhook handler itself).
  const sessionId = initResult.verification.vendor_inquiry_id;
  const kycWebhookResult = await handleDiditWebhook({ session_id: sessionId }, { sb: db as any, didit: mockDidit });
  assert.equal(kycWebhookResult.ok, true);

  const ial2Now = await hasValidIal2("deal-1", "owner-1", db as any);
  assert.equal(ial2Now, true);

  // 3. Now signing succeeds — mirrors postEsign in mock mode.
  const signResult = await mockRequestSignature(
    {
      dealId: "deal-1",
      bankId: "bank-brokerage",
      formCode: "SBA_1919",
      templateVersion: "v1",
      signerOwnershipEntityId: "owner-1",
      signerRole: "applicant",
      signerEmail: "jane@example.com",
      signerName: "Jane Doe",
    },
    { sb: db as any },
  );
  assert.equal(signResult.ok, true);
  if (!signResult.ok) return;
  assert.ok(signResult.embedUrl.includes("mock-complete-esign"));

  // 4. Complete signing — mirrors getMockCompleteEsign, calling the REAL
  // handleSignwellWebhook, which re-checks IAL2 at completion time too.
  const externalId = `deal:deal-1:form:SBA_1919:signer:owner-1`;
  const esignWebhookResult = await handleSignwellWebhook(
    {
      event: { type: "document_completed" },
      data: { object: { id: signResult.documentId, metadata: { external_id: externalId }, recipients: [{ id: "1" }] } },
    },
    {
      sb: db as any,
      signwell: {
        createSignwellDocumentFromFile: mockCreateSignwellDocumentFromFile,
        fetchSignwellDocument: mockFetchSignwellDocument,
        downloadSignwellCompletedPdf: mockDownloadSignwellCompletedPdf,
      },
    },
  );
  assert.equal(esignWebhookResult.ok, true);
  assert.equal(db.tables.signed_documents.length, 1);
  assert.equal(db.tables.signed_documents[0].form_code, "SBA_1919");
  assert.equal(db.tables.signed_documents[0].signer_ownership_entity_id, "owner-1");
  assert.equal(db.tables.signed_documents[0].esign_provider, "signwell");
  assert.ok(db.storageUploads.some((u) => u.bucket === "signed-documents"));

  // deal_events should carry a full audit trail of everything above.
  // mockFetchDiditSession reports Didit's "Approved" status, which
  // mapDiditStatus() maps to Buddy's "approved" (a TERMINAL_SUCCESS_STATUS,
  // same as "completed" — Didit's vocabulary just doesn't use that word).
  const eventKinds = db.tables.deal_events.map((e) => e.kind);
  assert.ok(eventKinds.includes("kyc.verification_initiated"));
  assert.ok(eventKinds.includes("kyc.verification_approved"));
  assert.ok(eventKinds.includes("esign.completed"));
});
