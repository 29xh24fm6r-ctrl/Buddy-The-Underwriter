import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { logSbaAssumptionsEvent } =
  require("../logSbaAssumptionsEvent") as typeof import("../logSbaAssumptionsEvent");

test("writes a row with the given event_type and detail", async () => {
  const inserted: any[] = [];
  const sb = { from: () => ({ insert: async (row: any) => { inserted.push(row); return { error: null }; } }) };

  await logSbaAssumptionsEvent(
    { dealId: "d1", bankId: "b1", eventType: "confirmed", detail: { foo: "bar" } },
    sb as any,
  );

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].deal_id, "d1");
  assert.equal(inserted[0].bank_id, "b1");
  assert.equal(inserted[0].event_type, "confirmed");
  assert.deepEqual(inserted[0].detail, { foo: "bar" });
});

test("defaults detail to {} when omitted", async () => {
  const inserted: any[] = [];
  const sb = { from: () => ({ insert: async (row: any) => { inserted.push(row); return { error: null }; } }) };

  await logSbaAssumptionsEvent({ dealId: "d1", bankId: "b1", eventType: "confirmed" }, sb as any);

  assert.deepEqual(inserted[0].detail, {});
});

test("never throws when the insert itself fails (best-effort, must not block the caller)", async () => {
  const sb = { from: () => ({ insert: async () => ({ error: { message: "boom" } }) }) };
  await assert.doesNotReject(
    logSbaAssumptionsEvent({ dealId: "d1", bankId: "b1", eventType: "confirmed" }, sb as any),
  );
});

test("never throws when the client itself throws", async () => {
  const sb = { from: () => { throw new Error("connection refused"); } };
  await assert.doesNotReject(
    logSbaAssumptionsEvent({ dealId: "d1", bankId: "b1", eventType: "confirmed" }, sb as any),
  );
});
