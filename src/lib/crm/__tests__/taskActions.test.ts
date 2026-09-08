import test from "node:test";
import assert from "node:assert/strict";
import { changeCrmTask, parseTaskChange } from "../taskActions";
import { listCrmTasks } from "../taskInventory";
const id = "11111111-2222-3333-4444-555555555555";
function fake(result: {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}) {
  const calls: unknown[][] = [];
  const query: any = {};
  for (const method of ["from", "update", "eq", "select", "is", "not", "order"])
    query[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return query;
    };
  query.maybeSingle = async () => result;
  query.range = async (...args: unknown[]) => {
    calls.push(["range", ...args]);
    return result;
  };
  return { sb: query, calls };
}
test("task mutation rejects malformed IDs, actions and dates", () => {
  for (const body of [
    null,
    {},
    { id: "x", action: "complete" },
    { id, action: "delete" },
    { id, action: "reschedule", dueAt: 4 },
    { id, action: "reschedule", dueAt: "bad" },
  ])
    assert.throws(() => parseTaskChange(body));
});
test("task parser strips user-supplied tenant/target fields", () => {
  assert.deepEqual(
    parseTaskChange({ id, action: "complete", bankId: "other", kind: "note" }),
    { id, action: "complete" },
  );
  assert.equal(
    parseTaskChange({
      id,
      action: "reschedule",
      dueAt: "2026-09-03T10:00:00-04:00",
    }).dueAt,
    "2026-09-03T14:00:00.000Z",
  );
});
test("every task mutation filters by tenant, ID and task kind", async () => {
  for (const action of ["complete", "reopen", "reschedule"] as const) {
    const { sb, calls } = fake({ data: { id } });
    assert.deepEqual(
      await changeCrmTask(
        sb,
        "bank",
        { id, action, dueAt: "2026-09-03T14:00:00Z" },
        "now",
      ),
      { id },
    );
    for (const filter of [
      ["eq", "bank_id", "bank"],
      ["eq", "id", id],
      ["eq", "kind", "task"],
    ])
      assert.ok(
        calls.some((c) => JSON.stringify(c) === JSON.stringify(filter)),
      );
    const update = calls.find((c) => c[0] === "update")?.[1];
    assert.deepEqual(
      update,
      action === "reschedule"
        ? { due_at: "2026-09-03T14:00:00Z" }
        : { completed_at: action === "complete" ? "now" : null },
    );
  }
});
test("missing/foreign/non-task targets do not report a saved task; database errors fail", async () => {
  assert.equal(
    await changeCrmTask(fake({ data: null }).sb, "bank", {
      id,
      action: "complete",
    }),
    null,
  );
  await assert.rejects(
    changeCrmTask(fake({ error: { message: "db error" } }).sb, "bank", {
      id,
      action: "complete",
    }),
    /not be confirmed/,
  );
});
test("inventory reads tasks independently of activity age with stable bounded pagination", async () => {
  const { sb, calls } = fake({ data: [{ id }], count: 230 });
  const result = await listCrmTasks(sb, "bank", 1);
  assert.equal(result.total, 230);
  assert.equal(result.pageSize, 100);
  for (const expected of [
    ["eq", "bank_id", "bank"],
    ["eq", "kind", "task"],
    ["is", "completed_at", null],
    ["range", 100, 199],
    ["order", "id"],
  ])
    assert.ok(
      calls.some((c) => JSON.stringify(c) === JSON.stringify(expected)),
    );
  assert.ok(!calls.some((c) => c.includes("happens_at")));
});
test("completed inventory supports reopening and preserves unknown counts", async () => {
  const { sb, calls } = fake({ data: [], count: null });
  assert.equal((await listCrmTasks(sb, "bank", 0, true)).total, null);
  assert.ok(
    calls.some(
      (c) =>
        JSON.stringify(c) ===
        JSON.stringify(["not", "completed_at", "is", null]),
    ),
  );
  await assert.rejects(listCrmTasks(fake({ error: {} }).sb, "bank", 0));
});
