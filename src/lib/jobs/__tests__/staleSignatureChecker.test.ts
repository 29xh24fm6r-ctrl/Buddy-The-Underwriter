import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findStaleSignatures,
  reconcileStaleSignatureGaps,
  writeStaleSignatureGaps,
} from "@/lib/jobs/staleSignatureChecker";

type Row = Record<string, any>;
type Operation = "select" | "upsert" | "update";

class Q {
  db: FakeDb;
  table: string;
  filters: Array<{ t: "eq" | "in"; k: string; v: any }> = [];
  orders: Array<{ k: string; ascending: boolean }> = [];
  operation: Operation = "select";
  payload: Row | Row[] | null = null;
  conflictCols: string[] = [];
  rangeStart = 0;
  rangeEnd = Number.MAX_SAFE_INTEGER;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_?: string) {
    this.operation = "select";
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
  order(k: string, opts?: { ascending?: boolean }) {
    this.orders.push({ k, ascending: opts?.ascending !== false });
    return this;
  }
  range(start: number, end: number) {
    this.rangeStart = start;
    this.rangeEnd = end;
    return this;
  }
  upsert(p: Row | Row[], opts?: { onConflict?: string }) {
    this.operation = "upsert";
    this.payload = p;
    this.conflictCols = (opts?.onConflict ?? "").split(",").filter(Boolean);
    return this;
  }
  update(p: Row) {
    this.operation = "update";
    this.payload = p;
    return this;
  }
  then(resolve: any, reject?: any) {
    const failure = this.db.failures[`${this.table}:${this.operation}`];
    if (failure) {
      return Promise.resolve({ data: null, error: { message: failure } }).then(resolve, reject);
    }

    if (this.operation === "select") {
      return Promise.resolve({ data: this.rows().slice(this.rangeStart, this.rangeEnd + 1), error: null }).then(
        resolve,
        reject,
      );
    }

    if (this.operation === "upsert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload!];
      this.db.tables[this.table] ??= [];
      for (const row of rows) {
        const existing = this.conflictCols.length
          ? this.db.tables[this.table].find((candidate) =>
              this.conflictCols.every((column) => candidate[column] === row[column]),
            )
          : undefined;
        if (existing) Object.assign(existing, row);
        else this.db.tables[this.table].push({ id: `id-${this.db.nextId++}`, ...row });
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    }

    for (const row of this.rows()) Object.assign(row, this.payload);
    return Promise.resolve({ data: null, error: null }).then(resolve, reject);
  }
  private rows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const filter of this.filters) {
      if (filter.t === "eq") rows = rows.filter((row) => row[filter.k] === filter.v);
      if (filter.t === "in") rows = rows.filter((row) => filter.v.includes(row[filter.k]));
    }
    for (const order of [...this.orders].reverse()) {
      rows.sort((a, b) => {
        if (a[order.k] === b[order.k]) return 0;
        const comparison = a[order.k] < b[order.k] ? -1 : 1;
        return order.ascending ? comparison : -comparison;
      });
    }
    return rows;
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  failures: Record<string, string>;
  nextId = 1;

  constructor(seed?: Partial<Record<string, Row[]>>, failures?: Record<string, string>) {
    this.tables = { signed_documents: [], deal_gap_queue: [], ...seed };
    this.failures = failures ?? {};
  }
  from(table: string) {
    return new Q(this, table);
  }
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function signedRow(
  overrides: Partial<Row> & Pick<Row, "id" | "expires_at" | "signature_completed_at">,
): Row {
  return {
    deal_id: "d1",
    bank_id: "b1",
    form_code: "FORM_1919",
    signer_ownership_entity_id: "o1",
    signer_role: "applicant",
    ...overrides,
  };
}

test("findStaleSignatures: returns a latest signature expiring within 14 days", async () => {
  const db = new FakeDb({
    signed_documents: [
      signedRow({
        id: "s1",
        signature_completed_at: isoDaysFromNow(-80),
        expires_at: isoDaysFromNow(10),
      }),
    ],
  });
  const result = await findStaleSignatures(db as any);
  assert.equal(result.length, 1);
  assert.equal(result[0].days_remaining, 10);
  assert.equal(result[0].signer_role, "applicant");
});

test("findStaleSignatures: ignores an expired historical signature after a valid replacement", async () => {
  const db = new FakeDb({
    signed_documents: [
      signedRow({
        id: "old",
        signature_completed_at: isoDaysFromNow(-100),
        expires_at: isoDaysFromNow(-10),
      }),
      signedRow({
        id: "replacement",
        signature_completed_at: isoDaysFromNow(-1),
        expires_at: isoDaysFromNow(89),
      }),
    ],
  });
  assert.deepEqual(await findStaleSignatures(db as any), []);
});

test("findStaleSignatures: evaluates the newest replacement when it is itself near expiry", async () => {
  const db = new FakeDb({
    signed_documents: [
      signedRow({
        id: "old",
        signature_completed_at: isoDaysFromNow(-100),
        expires_at: isoDaysFromNow(-10),
      }),
      signedRow({
        id: "replacement",
        signature_completed_at: isoDaysFromNow(-80),
        expires_at: isoDaysFromNow(10),
      }),
    ],
  });
  const result = await findStaleSignatures(db as any);
  assert.equal(result.length, 1);
  assert.equal(result[0].expires_at, db.tables.signed_documents[1].expires_at);
});

test("findStaleSignatures: keeps separate current state for separate signers", async () => {
  const db = new FakeDb({
    signed_documents: [
      signedRow({
        id: "owner-1",
        signer_ownership_entity_id: "o1",
        signature_completed_at: isoDaysFromNow(-80),
        expires_at: isoDaysFromNow(10),
      }),
      signedRow({
        id: "owner-2",
        signer_ownership_entity_id: "o2",
        signature_completed_at: isoDaysFromNow(-1),
        expires_at: isoDaysFromNow(89),
      }),
    ],
  });
  const result = await findStaleSignatures(db as any);
  assert.equal(result.length, 1);
  assert.equal(result[0].signer_id, "o1");
});

test("findStaleSignatures: paginates beyond the Data API default page size", async () => {
  const signedDocuments = Array.from({ length: 1_001 }, (_, index) =>
    signedRow({
      id: `s-${String(index).padStart(4, "0")}`,
      deal_id: `d-${index}`,
      signature_completed_at: isoDaysFromNow(-1),
      expires_at: isoDaysFromNow(index === 1_000 ? 5 : 90),
    }),
  );
  const db = new FakeDb({ signed_documents: signedDocuments });
  const result = await findStaleSignatures(db as any);
  assert.equal(result.length, 1);
  assert.equal(result[0].deal_id, "d-1000");
});

test("findStaleSignatures: fails closed when the signature read fails", async () => {
  const db = new FakeDb(undefined, { "signed_documents:select": "database unavailable" });
  await assert.rejects(
    () => findStaleSignatures(db as any),
    /stale_signature_read_failed: database unavailable/,
  );
});

test("writeStaleSignatureGaps: writes signer-specific gaps and checks the write result", async () => {
  const db = new FakeDb();
  const count = await writeStaleSignatureGaps(db as any, [
    {
      deal_id: "d1",
      bank_id: "b1",
      form_code: "FORM_1919",
      signer_id: "o1",
      signer_role: "applicant",
      expires_at: isoDaysFromNow(8),
      days_remaining: 8,
    },
    {
      deal_id: "d1",
      bank_id: "b1",
      form_code: "FORM_1919",
      signer_id: "o2",
      signer_role: "guarantor",
      expires_at: isoDaysFromNow(7),
      days_remaining: 7,
    },
  ]);
  assert.equal(count, 2);
  assert.equal(db.tables.deal_gap_queue.length, 2);
  assert.notEqual(db.tables.deal_gap_queue[0].fact_key, db.tables.deal_gap_queue[1].fact_key);
  assert.ok(db.tables.deal_gap_queue[0].description.includes("8 days"));
});

test("writeStaleSignatureGaps: fails closed when the upsert fails", async () => {
  const db = new FakeDb(undefined, { "deal_gap_queue:upsert": "write rejected" });
  await assert.rejects(
    () =>
      writeStaleSignatureGaps(db as any, [
        {
          deal_id: "d1",
          bank_id: "b1",
          form_code: "FORM_1919",
          signer_id: "o1",
          signer_role: "applicant",
          expires_at: isoDaysFromNow(8),
          days_remaining: 8,
        },
      ]),
    /stale_signature_gap_upsert_failed: write rejected/,
  );
});

test("reconcileStaleSignatureGaps: resolves a legacy stale gap after a replacement is signed", async () => {
  const db = new FakeDb({
    signed_documents: [
      signedRow({
        id: "old",
        signature_completed_at: isoDaysFromNow(-100),
        expires_at: isoDaysFromNow(-10),
      }),
      signedRow({
        id: "replacement",
        signature_completed_at: isoDaysFromNow(-1),
        expires_at: isoDaysFromNow(89),
      }),
    ],
    deal_gap_queue: [
      {
        id: "gap-1",
        deal_id: "d1",
        bank_id: "b1",
        gap_type: "sba_signature_stale",
        fact_type: "sba_form_signature",
        fact_key: "signed_documents.FORM_1919",
        owner_entity_id: "o1",
        status: "open",
      },
    ],
  });
  const result = await reconcileStaleSignatureGaps(db as any);
  assert.deepEqual(
    { found: result.findings.length, written: result.gapsWritten, resolved: result.gapsResolved },
    { found: 0, written: 0, resolved: 1 },
  );
  assert.equal(db.tables.deal_gap_queue[0].status, "resolved");
  assert.deepEqual(db.tables.deal_gap_queue[0].resolution_meta, {
    action: "superseded_by_current_signature",
  });
});

test("reconcileStaleSignatureGaps: preserves the active signer-specific gap on rerun", async () => {
  const db = new FakeDb({
    signed_documents: [
      signedRow({
        id: "current",
        signature_completed_at: isoDaysFromNow(-80),
        expires_at: isoDaysFromNow(10),
      }),
    ],
  });
  const first = await reconcileStaleSignatureGaps(db as any);
  const second = await reconcileStaleSignatureGaps(db as any);
  assert.equal(first.gapsWritten, 1);
  assert.equal(second.gapsWritten, 1);
  assert.equal(second.gapsResolved, 0);
  assert.equal(db.tables.deal_gap_queue.length, 1);
  assert.equal(db.tables.deal_gap_queue[0].status, "open");
});
