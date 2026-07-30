import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkSchemaParity, type SchemaManifestEntry } from "../schemaParityCheck";

function mockClient(exists: Record<string, boolean>, erroring: Set<string> = new Set()) {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      const key =
        fn === "buddy_table_exists"
          ? `table:${args.p_table_name}`
          : fn === "buddy_column_exists"
            ? `column:${args.p_table_name}.${args.p_column_name}`
            : `view:${args.p_view_name}`;
      return {
        maybeSingle: async () => {
          if (erroring.has(key)) return { data: null, error: { message: "rpc failed" } };
          return { data: { exists: exists[key] ?? false }, error: null };
        },
      };
    },
  };
}

const MANIFEST: SchemaManifestEntry[] = [
  { name: "ai_gateway_calls", type: "table", migration: "20260729000000_ai_gateway_calls.sql" },
  { name: "buddy_trident_bundles.business_plan_attested", type: "column", migration: "x.sql" },
  { name: "v_beat_summary", type: "view", migration: "x.sql" },
  { name: "purge_buddy_workers", type: "function", migration: "x.sql" },
];

describe("checkSchemaParity", () => {
  it("passes (ok) when every checkable entry exists live", async () => {
    const sb = mockClient({
      "table:ai_gateway_calls": true,
      "column:buddy_trident_bundles.business_plan_attested": true,
      "view:v_beat_summary": true,
    });
    const r = await checkSchemaParity(sb, MANIFEST);
    assert.equal(r.status, "ok");
    assert.match(r.value, /3 manifest entries checked, all present live/);
  });

  it("skips function entries entirely (no buddy_function_exists RPC)", async () => {
    const sb = mockClient({
      "table:ai_gateway_calls": true,
      "column:buddy_trident_bundles.business_plan_attested": true,
      "view:v_beat_summary": true,
    });
    const r = await checkSchemaParity(sb, MANIFEST);
    // Only 3 checkable (table+column+view); the function entry contributes
    // nothing to the denominator and is never RPC'd.
    assert.match(r.value, /3 manifest entries checked/);
  });

  it("fails when a manifest table entry does not exist live (the 2026-07-30 failure mode)", async () => {
    const sb = mockClient({
      "table:ai_gateway_calls": false,
      "column:buddy_trident_bundles.business_plan_attested": true,
      "view:v_beat_summary": true,
    });
    const r = await checkSchemaParity(sb, MANIFEST);
    assert.equal(r.status, "warn");
    assert.match(r.value, /missing live: table ai_gateway_calls/);
  });

  it("treats an RPC error as missing, not a silent pass", async () => {
    const sb = mockClient(
      { "column:buddy_trident_bundles.business_plan_attested": true, "view:v_beat_summary": true },
      new Set(["table:ai_gateway_calls"]),
    );
    const r = await checkSchemaParity(sb, MANIFEST);
    assert.match(r.value, /missing live: table ai_gateway_calls/);
  });

  it("escalates to fail when more than 2 entries are missing", async () => {
    const sb = mockClient({});
    const r = await checkSchemaParity(sb, MANIFEST);
    assert.equal(r.status, "fail");
  });

  it("splits column entries on the table.column dot correctly", async () => {
    let capturedArgs: Record<string, unknown> | null = null;
    const sb = {
      rpc(fn: string, args: Record<string, unknown>) {
        if (fn === "buddy_column_exists") capturedArgs = args;
        return { maybeSingle: async () => ({ data: { exists: true }, error: null }) };
      },
    };
    await checkSchemaParity(sb, [
      { name: "buddy_sba_packages.verification_verdict", type: "column", migration: "x.sql" },
    ]);
    assert.deepEqual(capturedArgs, {
      p_table_name: "buddy_sba_packages",
      p_column_name: "verification_verdict",
    });
  });
});
