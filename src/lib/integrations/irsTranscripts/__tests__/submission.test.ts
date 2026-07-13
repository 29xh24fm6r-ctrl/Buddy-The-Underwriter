import { test } from "node:test";
import assert from "node:assert/strict";
import { submitTranscriptRequest, type IrsTranscriptVendorClient } from "@/lib/integrations/irsTranscripts/submission";

type Row = Record<string, any>;

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ k: string; v: any }> = [];
  _i: Row[] | null = null;
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_?: string) {
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ k, v });
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
  single() {
    return Promise.resolve({ data: this._i ? this._i[0] : this.rows()[0] ?? null, error: null });
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(resolve: any, reject?: any) {
    return Promise.resolve({ data: this._i ?? this.rows(), error: null }).then(resolve, reject);
  }
  private rows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) rows = rows.filter((r) => r[f.k] === f.v);
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = { borrower_irs_transcript_requests: [], signed_documents: [], deal_events: [], ...seed };
  }
  from(t: string) {
    return new Q(this, t);
  }
}

const BASE_ARGS = {
  dealId: "d1",
  bankId: "b1",
  ownershipEntityId: "o1",
  signed4506cId: "sd1",
  taxYears: [2023, 2024],
  transcriptTypes: ["return", "wage_income"],
};

function makeVendor(overrides?: Partial<IrsTranscriptVendorClient>): IrsTranscriptVendorClient {
  return {
    currentIrsVendor: () => "ncs",
    submitVendorTranscriptRequest: async () => ({ vendor_request_id: "vr_1", status: "submitted" }),
    ...overrides,
  };
}

test("submitTranscriptRequest: happy path -> status='submitted', next_poll_at set", async () => {
  const db = new FakeDb({ signed_documents: [{ id: "sd1", form_code: "FORM_4506C", signed_pdf_storage_path: "path/to.pdf" }] });
  const result = await submitTranscriptRequest(BASE_ARGS, {
    sb: db as any,
    vendor: makeVendor(),
    downloadSigned4506cPdf: async () => Buffer.from("pdf-bytes"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "submitted");
  assert.equal(db.tables.borrower_irs_transcript_requests.length, 1);
  assert.ok(db.tables.borrower_irs_transcript_requests[0].next_poll_at);
  assert.ok(db.tables.deal_events.some((e) => e.kind === "irs.transcript_submitted"));
});

test("submitTranscriptRequest: missing signed 4506-C -> SIGNED_4506C_NOT_FOUND", async () => {
  const db = new FakeDb();
  const result = await submitTranscriptRequest(BASE_ARGS, {
    sb: db as any,
    vendor: makeVendor(),
    downloadSigned4506cPdf: async () => Buffer.from("pdf-bytes"),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "SIGNED_4506C_NOT_FOUND");
});

test("submitTranscriptRequest: vendor failure -> VENDOR_REQUEST_FAILED, no DB row inserted", async () => {
  const db = new FakeDb({ signed_documents: [{ id: "sd1", form_code: "FORM_4506C", signed_pdf_storage_path: "path/to.pdf" }] });
  const result = await submitTranscriptRequest(BASE_ARGS, {
    sb: db as any,
    vendor: makeVendor({
      submitVendorTranscriptRequest: async () => {
        throw new Error("vendor down");
      },
    }),
    downloadSigned4506cPdf: async () => Buffer.from("pdf-bytes"),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "VENDOR_REQUEST_FAILED");
  assert.equal(db.tables.borrower_irs_transcript_requests.length, 0);
});

test("submitTranscriptRequest: same signed4506cId + tax years re-submitted -> idempotent reuse, vendor not called", async () => {
  const db = new FakeDb({ signed_documents: [{ id: "sd1", form_code: "FORM_4506C", signed_pdf_storage_path: "path/to.pdf" }] });
  let callCount = 0;
  const vendor = makeVendor({
    submitVendorTranscriptRequest: async () => {
      callCount++;
      return { vendor_request_id: "vr_1", status: "submitted" };
    },
  });
  const deps = { sb: db as any, vendor, downloadSigned4506cPdf: async () => Buffer.from("pdf-bytes") };

  const first = await submitTranscriptRequest(BASE_ARGS, deps);
  const second = await submitTranscriptRequest(BASE_ARGS, deps);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.reused, true);
  assert.equal(callCount, 1);
  assert.equal(db.tables.borrower_irs_transcript_requests.length, 1);
});
