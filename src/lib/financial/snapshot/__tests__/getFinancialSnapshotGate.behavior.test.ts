import test from "node:test";
import assert from "node:assert/strict";
import { financialFactFingerprint } from "@/lib/financialFacts/fingerprint";

require.cache[require.resolve("server-only")] = {
  id: require.resolve("server-only"), filename: require.resolve("server-only"),
  loaded: true, exports: {}, children: [], paths: [],
} as unknown as NodeModule;
const { loadFinancialSnapshotValidation } = require("../getFinancialSnapshotGate") as typeof import("../getFinancialSnapshotGate");
const facts = [{ id: "fact", fact_key: "NET_INCOME", fact_value_num: 100000, resolution_status: "confirmed" }];
const snapshot = {
  id: "latest-snapshot", created_at: "2026-09-11T12:00:00Z", snapshot_hash: "hash",
  snapshot_json: { completeness_pct: 100, missing_required_keys: [], input_facts_hash: financialFactFingerprint(facts) },
};

function clientFor(input: { snapshot?: unknown; gaps?: unknown[]; facts?: unknown[]; fail?: string } = {}) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const client = { from(table: string) {
    assert.ok(["financial_snapshots", "deal_gap_queue", "deal_financial_facts"].includes(table), `competing store queried: ${table}`);
    const result = () => ({ data: table === "financial_snapshots" ? ("snapshot" in input ? input.snapshot : snapshot)
      : table === "deal_gap_queue" ? (input.gaps ?? []) : (input.facts ?? facts),
      error: input.fail === table ? { message: "database unavailable" } : null });
    const query: any = { then(resolve: (v: unknown) => void) { return Promise.resolve(result()).then(resolve); } };
    for (const op of ["select", "eq", "order", "limit", "range"]) query[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return query; };
    query.maybeSingle = async () => result();
    return query;
  } } as unknown as NonNullable<Parameters<typeof loadFinancialSnapshotValidation>[1]>["client"];
  return { client, calls };
}
async function check(input: Parameters<typeof clientFor>[0] = {}) {
  const { client, calls } = clientFor(input);
  const result = await loadFinancialSnapshotValidation("deal", { client, bankId: "bank" });
  for (const table of new Set(calls.map(c => c.table))) {
    assert.ok(calls.some(c => c.table === table && c.op === "eq" && c.args[0] === "deal_id" && c.args[1] === "deal"));
    assert.ok(calls.some(c => c.table === table && c.op === "eq" && c.args[0] === "bank_id" && c.args[1] === "bank"));
  }
  return result;
}

test("writer's snapshot is the only readiness source and latest row wins", async () => {
  const { client, calls } = clientFor();
  const result = await loadFinancialSnapshotValidation("deal", { client });
  assert.equal(result.gate.ready, true);
  assert.equal(result.snapshot?.id, "latest-snapshot");
  assert.ok(calls.some(c => c.table === "financial_snapshots" && c.op === "order" && c.args[0] === "created_at" && (c.args[1] as any).ascending === false));
  assert.ok(calls.some(c => c.table === "financial_snapshots" && c.op === "limit" && c.args[0] === 1));
});

test("no snapshot blocks even with an empty gap queue", async () => {
  assert.equal((await check({ snapshot: null })).gate.blockerCode, "financial_snapshot_missing");
});
for (const body of [
  { completeness_pct: 75, missing_required_keys: [] },
  { completeness_pct: 100, missing_required_keys: ["dscr"] },
  { completeness_pct: 100 },
  { completeness_pct: NaN, missing_required_keys: [] },
  { completeness_pct: 101, missing_required_keys: [] },
]) test(`incomplete or malformed snapshot cannot pass: ${JSON.stringify(body)}`, async () => {
  const result = await check({ snapshot: { ...snapshot, snapshot_json: { ...body, input_facts_hash: financialFactFingerprint(facts) } } });
  assert.equal(result.gate.blockerCode, "financial_validation_open");
});
for (const gap_type of ["conflict", "missing_fact"]) test(`${gap_type} blocks a complete snapshot`, async () => {
  assert.equal((await check({ gaps: [{ gap_type }] })).gate.ready, false);
});
test("low confidence remains advisory in the committee gate", async () => {
  assert.equal((await check({ gaps: [{ gap_type: "low_confidence" }] })).gate.ready, true);
});
for (const change of [{ fact_value_num: 200000 }, { resolution_status: "rejected" }, { is_superseded: true }, { entity_id: "other-entity" }]) {
  test(`source change invalidates snapshot: ${JSON.stringify(change)}`, async () => {
    assert.equal((await check({ facts: [{ ...facts[0], ...change }] })).gate.blockerCode, "financial_snapshot_stale");
  });
}
test("historical snapshots without evidence fingerprints require a rebuild", async () => {
  assert.equal((await check({ snapshot: { ...snapshot, snapshot_json: { completeness_pct: 100, missing_required_keys: [] } } })).gate.blockerCode, "financial_snapshot_stale");
});
for (const fail of ["financial_snapshots", "deal_gap_queue", "deal_financial_facts"]) test(`${fail} failure cannot fabricate readiness`, async () => {
  const { gate } = await check({ fail });
  assert.equal(gate.evaluationStatus, "unavailable");
  assert.equal(gate.ready, false);
  assert.equal(gate.evidence, null);
});
test("fact ordering and write timestamps do not change the evidence fingerprint", () => {
  const more = { ...facts[0], id: "second" };
  assert.equal(financialFactFingerprint([...facts, more]), financialFactFingerprint([{ ...more, updated_at: "later" }, ...facts]));
});

test("writing the snapshot's stress output does not invalidate its own inputs", () => {
  const output = { id: "output", fact_key: "DSCR_STRESSED_300BPS", fact_value_num: 1.2,
    provenance: { source_ref: "computed:stress:rate_up_300bps" } };
  assert.equal(financialFactFingerprint(facts), financialFactFingerprint([...facts, output]));
  assert.notEqual(financialFactFingerprint(facts), financialFactFingerprint([...facts, { ...output, provenance: {} }]));
});

test("snapshot inputs include every page rather than silently truncating a large deal", async () => {
  const { loadSnapshotFactInputs } = require("../loadSnapshotFactInputs") as typeof import("../loadSnapshotFactInputs");
  const all = Array.from({ length: 1201 }, (_, i) => ({ id: String(i).padStart(4, "0"), fact_value_num: i }));
  const ranges: number[][] = [];
  const query: any = { select() { return this; }, eq() { return this; }, order() { return this; },
    async range(start: number, end: number) { ranges.push([start, end]); return { data: all.slice(start, end + 1), error: null }; } };
  const loaded = await loadSnapshotFactInputs({ from: () => query } as any, "deal", "bank");
  assert.deepEqual(loaded, all);
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);
});
