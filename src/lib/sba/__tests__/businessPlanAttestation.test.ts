import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const {
  hashPackageNarratives,
  getBusinessPlanAttestationStatus,
  recordBusinessPlanAttestation,
} = require("../businessPlanAttestation") as typeof import("../businessPlanAttestation");

type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  function builder(tableName: string) {
    const stored = tables[tableName] ?? (tables[tableName] = []);
    let rows = [...stored];
    let op: "select" | "insert" = "select";
    let payload: any = null;

    const q: any = {
      select() {
        return q;
      },
      eq(col: string, val: any) {
        rows = rows.filter((r) => r[col] === val);
        return q;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        const asc = opts?.ascending !== false;
        rows = [...rows].sort((a, b) => {
          if (a[col] === b[col]) return 0;
          return (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1);
        });
        return q;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return q;
      },
      insert(p: any) {
        op = "insert";
        payload = p;
        return q;
      },
      maybeSingle() {
        return Promise.resolve(exec());
      },
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve(exec()).then(onFulfilled, onRejected);
      },
    };

    function exec() {
      if (op === "insert") {
        stored.push({ id: `gen-${stored.length + 1}`, ...payload });
        return { data: null, error: null };
      }
      return { data: rows[0] ?? null, error: null };
    }

    return q;
  }
  return { from: builder };
}

test("hashPackageNarratives is stable across key order and ignores non-narrative columns", () => {
  const pkgA = { business_overview_narrative: "hello", dscr_year1_base: 1.3 };
  const pkgB = { dscr_year1_base: 9.9, business_overview_narrative: "hello" };
  assert.equal(hashPackageNarratives(pkgA), hashPackageNarratives(pkgB));
});

test("hashPackageNarratives changes when narrative text changes", () => {
  const h1 = hashPackageNarratives({ business_overview_narrative: "hello" });
  const h2 = hashPackageNarratives({ business_overview_narrative: "goodbye" });
  assert.notEqual(h1, h2);
});

test("getBusinessPlanAttestationStatus reports not-attested when no row exists", async () => {
  const db = makeDb({});
  const status = await getBusinessPlanAttestationStatus("deal-1", "hash-a", db);
  assert.equal(status.attested, false);
  assert.equal(status.snapshotMatchesCurrent, false);
});

test("recordBusinessPlanAttestation then getStatus reports attested + matching snapshot", async () => {
  const db = makeDb({});
  await recordBusinessPlanAttestation({
    dealId: "deal-1",
    bankId: "bank-1",
    packageId: "pkg-1",
    narrativeSnapshotHash: "hash-a",
    attestedByName: "Jane Doe",
    attestedByEmail: "jane@example.com",
    sb: db,
  });

  const status = await getBusinessPlanAttestationStatus("deal-1", "hash-a", db);
  assert.equal(status.attested, true);
  assert.equal(status.snapshotMatchesCurrent, true);
  assert.equal(status.attestedByName, "Jane Doe");
});

test("a stale attestation (narrative regenerated since) reports attested but not matching", async () => {
  const db = makeDb({});
  await recordBusinessPlanAttestation({
    dealId: "deal-1",
    bankId: "bank-1",
    packageId: "pkg-1",
    narrativeSnapshotHash: "hash-old",
    attestedByName: "Jane Doe",
    attestedByEmail: "jane@example.com",
    sb: db,
  });

  const status = await getBusinessPlanAttestationStatus("deal-1", "hash-new", db);
  assert.equal(status.attested, true);
  assert.equal(status.snapshotMatchesCurrent, false);
});
