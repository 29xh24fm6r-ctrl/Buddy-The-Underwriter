import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractCreatedObjects, isRegistered, type ManifestEntry } from "../schema-manifest";

describe("extractCreatedObjects", () => {
  it("finds a CREATE TABLE", () => {
    const objs = extractCreatedObjects(
      "CREATE TABLE IF NOT EXISTS public.deal_hostile_interrogations (\n  id uuid PRIMARY KEY\n);",
    );
    assert.deepEqual(objs, [{ name: "deal_hostile_interrogations", type: "table" }]);
  });

  it("finds every ADD COLUMN in a single multi-column ALTER TABLE", () => {
    const objs = extractCreatedObjects(
      `ALTER TABLE public.buddy_trident_bundles
        ADD COLUMN IF NOT EXISTS business_plan_attested boolean,
        ADD COLUMN IF NOT EXISTS business_plan_attested_at timestamptz;`,
    );
    assert.deepEqual(objs, [
      { name: "buddy_trident_bundles.business_plan_attested", type: "column" },
      { name: "buddy_trident_bundles.business_plan_attested_at", type: "column" },
    ]);
  });

  it("finds CREATE [OR REPLACE] VIEW", () => {
    const objs = extractCreatedObjects(
      "CREATE OR REPLACE VIEW public.v_beat_summary AS\nSELECT 1;",
    );
    assert.deepEqual(objs, [{ name: "v_beat_summary", type: "view" }]);
  });

  it("finds CREATE [OR REPLACE] FUNCTION", () => {
    const objs = extractCreatedObjects(
      "CREATE OR REPLACE FUNCTION public.purge_buddy_workers(p_keep_days int DEFAULT 30)\nRETURNS bigint\nLANGUAGE plpgsql\nAS $$ BEGIN END; $$;",
    );
    assert.deepEqual(objs, [{ name: "purge_buddy_workers", type: "function" }]);
  });

  it("does not extract anything from an ALTER TABLE that only touches constraints/policies", () => {
    const objs = extractCreatedObjects(
      `ALTER TABLE public.brokerage_conversion_events
        DROP CONSTRAINT IF EXISTS brokerage_conversion_events_event_type_check;
       ALTER TABLE public.brokerage_conversion_events
        ADD CONSTRAINT brokerage_conversion_events_event_type_check
        CHECK (event_type IN ('a', 'b'));`,
    );
    assert.deepEqual(objs, []);
  });

  it("does not extract anything from a DROP TABLE-only migration", () => {
    const objs = extractCreatedObjects("DROP TABLE public.aegis_recording_sessions RESTRICT;");
    assert.deepEqual(objs, []);
  });
});

describe("isRegistered", () => {
  const manifest: ManifestEntry[] = [
    { name: "ai_gateway_calls", type: "table", migration: "20260729000000_ai_gateway_calls.sql" },
  ];

  it("matches an entry with identical name/type/migration", () => {
    assert.equal(
      isRegistered({ name: "ai_gateway_calls", type: "table" }, "20260729000000_ai_gateway_calls.sql", manifest),
      true,
    );
  });

  it("does not match when the migration filename differs", () => {
    assert.equal(
      isRegistered({ name: "ai_gateway_calls", type: "table" }, "some_other_file.sql", manifest),
      false,
    );
  });

  it("does not match when the type differs", () => {
    assert.equal(
      isRegistered({ name: "ai_gateway_calls", type: "view" }, "20260729000000_ai_gateway_calls.sql", manifest),
      false,
    );
  });
});
