import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findOverdueThirdPartyOrders,
  reconcileOverdueThirdPartyGaps,
  writeOverdueThirdPartyGaps,
} from "@/lib/jobs/thirdPartyOverdueChecker";

type Row = Record<string, any>;
type Filter =
  | { type: "in"; key: string; value: any[] }
  | { type: "lt" | "eq"; key: string; value: any };

class Query {
  private readonly db: FakeDb;
  private readonly table: string;
  private filters: Filter[] = [];
  private orders: Array<{ key: string; ascending: boolean }> = [];
  private rangeBounds: [number, number] | null = null;
  private operation: "select" | "upsert" | "update" = "select";
  private payload: Row[] = [];
  private conflictColumns: string[] = [];

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select(_columns?: string) {
    this.operation = "select";
    return this;
  }

  in(key: string, value: any[]) {
    this.filters.push({ type: "in", key, value });
    return this;
  }

  lt(key: string, value: any) {
    this.filters.push({ type: "lt", key, value });
    return this;
  }

  eq(key: string, value: any) {
    this.filters.push({ type: "eq", key, value });
    return this;
  }

  order(key: string, options?: { ascending?: boolean }) {
    this.orders.push({ key, ascending: options?.ascending !== false });
    return this;
  }

  range(from: number, to: number) {
    this.rangeBounds = [from, to];
    return this;
  }

  upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    this.operation = "upsert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    this.conflictColumns = (options?.onConflict ?? "")
      .split(",")
      .filter(Boolean);
    return this;
  }

  update(payload: Row) {
    this.operation = "update";
    this.payload = [payload];
    return this;
  }

  then(resolve: any, reject?: any) {
    try {
      return Promise.resolve(this.execute()).then(resolve, reject);
    } catch (error) {
      return Promise.reject(error).then(resolve, reject);
    }
  }

  private filteredRows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const filter of this.filters) {
      if (filter.type === "in") {
        rows = rows.filter((row) => filter.value.includes(row[filter.key]));
      } else if (filter.type === "lt") {
        rows = rows.filter((row) => row[filter.key] < filter.value);
      } else {
        rows = rows.filter((row) => row[filter.key] === filter.value);
      }
    }

    for (const order of [...this.orders].reverse()) {
      rows.sort((left, right) => {
        if (left[order.key] === right[order.key]) return 0;
        const result = left[order.key] < right[order.key] ? -1 : 1;
        return order.ascending ? result : -result;
      });
    }

    return rows;
  }

  private execute(): { data: Row[] | null; error: { message: string } | null } {
    const failure = this.db.failures[`${this.table}:${this.operation}`];
    if (failure) return { data: null, error: { message: failure } };

    if (this.operation === "select") {
      let rows = this.filteredRows();
      if (this.rangeBounds) {
        rows = rows.slice(this.rangeBounds[0], this.rangeBounds[1] + 1);
      }
      return { data: rows, error: null };
    }

    this.db.tables[this.table] ??= [];

    if (this.operation === "upsert") {
      this.db.upsertBatchSizes.push(this.payload.length);
      for (const row of this.payload) {
        const existing = this.conflictColumns.length
          ? this.db.tables[this.table].find((candidate) =>
              this.conflictColumns.every(
                (column) => candidate[column] === row[column],
              ),
            )
          : undefined;
        if (existing) Object.assign(existing, row);
        else {
          this.db.idSequence += 1;
          this.db.tables[this.table].push({
            id: `generated-${this.db.idSequence}`,
            ...row,
          });
        }
      }
      return { data: this.payload, error: null };
    }

    const matches = this.filteredRows();
    for (const row of matches) Object.assign(row, this.payload[0]);
    return { data: matches, error: null };
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  failures: Record<string, string>;
  upsertBatchSizes: number[] = [];
  idSequence = 0;

  constructor(
    seed?: Partial<Record<string, Row[]>>,
    failures: Record<string, string> = {},
  ) {
    this.tables = {
      third_party_orders: [],
      deal_gap_queue: [],
      ...seed,
    };
    this.failures = failures;
  }

  from(table: string) {
    return new Query(this, table);
  }
}

const NOW = new Date("2026-08-26T12:00:00.000Z");

function isoDaysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function order(
  id: string,
  overrides: Partial<Row> = {},
): Row {
  return {
    id,
    deal_id: "deal-1",
    bank_id: "bank-1",
    order_type: "ucc_lien_search",
    status: "dispatched",
    expected_completion_at: isoDaysBefore(3),
    ...overrides,
  };
}

test("findOverdueThirdPartyOrders returns dispatched and in-progress orders past SLA", async () => {
  const db = new FakeDb({
    third_party_orders: [
      order("order-1"),
      order("order-2", { status: "in_progress", order_type: "hazard_insurance" }),
      order("order-3", {
        status: "in_progress",
        expected_completion_at: new Date(
          NOW.getTime() + 5 * 86_400_000,
        ).toISOString(),
      }),
      order("order-4", { status: "delivered" }),
      order("order-5", { status: "cancelled" }),
      order("order-6", { expected_completion_at: null }),
    ],
  });

  const findings = await findOverdueThirdPartyOrders(db as any, NOW);
  assert.deepEqual(
    findings.map((finding) => finding.order_id).sort(),
    ["order-1", "order-2"],
  );
  assert.equal(findings[0].days_overdue, 3);
});

test("findOverdueThirdPartyOrders paginates beyond the Data API row cap", async () => {
  const db = new FakeDb({
    third_party_orders: Array.from({ length: 1_005 }, (_, index) =>
      order(`order-${String(index).padStart(4, "0")}`),
    ),
  });

  const findings = await findOverdueThirdPartyOrders(db as any, NOW);
  assert.equal(findings.length, 1_005);
  assert.equal(findings.at(-1)?.order_id, "order-1004");
});

test("writeOverdueThirdPartyGaps creates one identity per order, even for the same type", async () => {
  const db = new FakeDb();
  const findings = await findOverdueThirdPartyOrders(
    new FakeDb({
      third_party_orders: [
        order("order-1"),
        order("order-2", { deal_id: "deal-1" }),
      ],
    }) as any,
    NOW,
  );

  const written = await writeOverdueThirdPartyGaps(db as any, findings);

  assert.equal(written, 2);
  assert.equal(db.tables.deal_gap_queue.length, 2);
  assert.deepEqual(
    db.tables.deal_gap_queue
      .map((gap) => gap.fact_key)
      .sort(),
    ["third_party_orders.order-1", "third_party_orders.order-2"],
  );
});

test("writeOverdueThirdPartyGaps chunks large backlogs and updates active gaps", async () => {
  const db = new FakeDb();
  const findings = Array.from({ length: 1_005 }, (_, index) => ({
    order_id: `order-${index}`,
    deal_id: "deal-1",
    bank_id: "bank-1",
    order_type: "ucc_lien_search",
    status: "dispatched",
    expected_completion_at: isoDaysBefore(3),
    days_overdue: 3,
  }));

  await writeOverdueThirdPartyGaps(db as any, findings);
  findings[0].days_overdue = 8;
  await writeOverdueThirdPartyGaps(db as any, [findings[0]]);

  assert.deepEqual(db.upsertBatchSizes.slice(0, 3), [500, 500, 5]);
  assert.equal(db.tables.deal_gap_queue.length, 1_005);
  assert.equal(db.tables.deal_gap_queue[0].priority, 1);
  assert.match(db.tables.deal_gap_queue[0].description, /8 days/);
});

test("reconcile resolves gaps after delivery or cancellation while preserving active gaps", async () => {
  const db = new FakeDb({
    third_party_orders: [order("active-order")],
    deal_gap_queue: [
      {
        id: "gap-active",
        deal_id: "deal-1",
        gap_type: "third_party_order_overdue",
        fact_type: "third_party_order",
        fact_key: "third_party_orders.active-order",
        status: "open",
      },
      {
        id: "gap-recovered",
        deal_id: "deal-2",
        gap_type: "third_party_order_overdue",
        fact_type: "third_party_order",
        fact_key: "third_party_orders.delivered-order",
        status: "open",
      },
    ],
  });

  const result = await reconcileOverdueThirdPartyGaps(db as any, NOW);

  assert.equal(result.gapsWritten, 1);
  assert.equal(result.gapsResolved, 1);
  assert.equal(db.tables.deal_gap_queue[0].status, "open");
  assert.equal(db.tables.deal_gap_queue[1].status, "resolved");
  assert.equal(
    db.tables.deal_gap_queue[1].resolution_meta.action,
    "third_party_order_no_longer_overdue",
  );
  assert.equal(
    db.tables.deal_gap_queue[1].fact_key,
    "third_party_orders.delivered-order.resolved.gap-recovered",
  );
});

test("reconcile archives legacy type-keyed gaps and creates order-specific replacements", async () => {
  const db = new FakeDb({
    third_party_orders: [order("order-1")],
    deal_gap_queue: [
      {
        id: "legacy-gap",
        deal_id: "deal-1",
        gap_type: "third_party_order_overdue",
        fact_type: "third_party_order",
        fact_key: "third_party_orders.ucc_lien_search",
        status: "open",
      },
    ],
  });

  const result = await reconcileOverdueThirdPartyGaps(db as any, NOW);

  assert.equal(result.gapsWritten, 1);
  assert.equal(result.gapsResolved, 1);
  assert.equal(
    db.tables.deal_gap_queue.filter((gap) => gap.status === "open").length,
    1,
  );
  assert.equal(
    db.tables.deal_gap_queue.find((gap) => gap.status === "open")?.fact_key,
    "third_party_orders.order-1",
  );
});

test("reconcile paginates and resolves more than 1,000 recovered gaps", async () => {
  const db = new FakeDb({
    deal_gap_queue: Array.from({ length: 1_003 }, (_, index) => ({
      id: `gap-${String(index).padStart(4, "0")}`,
      deal_id: `deal-${index}`,
      gap_type: "third_party_order_overdue",
      fact_type: "third_party_order",
      fact_key: `third_party_orders.order-${index}`,
      status: "open",
    })),
  });

  const result = await reconcileOverdueThirdPartyGaps(db as any, NOW);

  assert.equal(result.gapsResolved, 1_003);
  assert.equal(
    db.tables.deal_gap_queue.filter((gap) => gap.status === "resolved").length,
    1_003,
  );
});

test("database read, upsert, and resolution failures are fatal", async () => {
  await assert.rejects(
    () =>
      findOverdueThirdPartyOrders(
        new FakeDb({}, { "third_party_orders:select": "read unavailable" }) as any,
        NOW,
      ),
    /third_party_overdue_order_read_failed: read unavailable/,
  );

  await assert.rejects(
    () =>
      writeOverdueThirdPartyGaps(
        new FakeDb({}, { "deal_gap_queue:upsert": "write unavailable" }) as any,
        [
          {
            order_id: "order-1",
            deal_id: "deal-1",
            bank_id: "bank-1",
            order_type: "ucc_lien_search",
            status: "dispatched",
            expected_completion_at: isoDaysBefore(3),
            days_overdue: 3,
          },
        ],
      ),
    /third_party_overdue_gap_upsert_failed: write unavailable/,
  );

  const db = new FakeDb(
    {
      deal_gap_queue: [
        {
          id: "gap-1",
          deal_id: "deal-1",
          gap_type: "third_party_order_overdue",
          fact_type: "third_party_order",
          fact_key: "third_party_orders.order-1",
          status: "open",
        },
      ],
    },
    { "deal_gap_queue:update": "resolution unavailable" },
  );

  await assert.rejects(
    () => reconcileOverdueThirdPartyGaps(db as any, NOW),
    /third_party_overdue_gap_resolve_failed: resolution unavailable/,
  );
});
