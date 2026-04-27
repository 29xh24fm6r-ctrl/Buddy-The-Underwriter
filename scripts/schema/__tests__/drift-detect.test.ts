import assert from "node:assert/strict";
import test from "node:test";

import {
  extractExpectedObjects,
  isAllowed,
  statementMentionsObject,
  type DriftFinding,
} from "../drift-detect";

test("extractExpectedObjects: basic CREATE TABLE without schema", () => {
  const got = extractExpectedObjects([
    "CREATE TABLE deals (id uuid primary key, name text);",
  ]);
  assert.deepEqual(got, [{ kind: "table", schema: "public", name: "deals" }]);
});

test("extractExpectedObjects: CREATE TABLE IF NOT EXISTS with schema-qualified name", () => {
  const got = extractExpectedObjects([
    "CREATE TABLE IF NOT EXISTS public.committee_personas (id uuid);",
  ]);
  assert.deepEqual(got, [
    { kind: "table", schema: "public", name: "committee_personas" },
  ]);
});

test("extractExpectedObjects: ALTER TABLE with multiple ADD COLUMNs", () => {
  const got = extractExpectedObjects([
    `ALTER TABLE public.sba_policy_rules
       ADD COLUMN IF NOT EXISTS category text,
       ADD COLUMN IF NOT EXISTS borrower_friendly_explanation text,
       ADD COLUMN IF NOT EXISTS fix_suggestions jsonb,
       ADD COLUMN IF NOT EXISTS effective_date date,
       ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();`,
  ]);
  assert.deepEqual(got, [
    {
      kind: "column",
      schema: "public",
      table: "sba_policy_rules",
      name: "category",
    },
    {
      kind: "column",
      schema: "public",
      table: "sba_policy_rules",
      name: "borrower_friendly_explanation",
    },
    {
      kind: "column",
      schema: "public",
      table: "sba_policy_rules",
      name: "fix_suggestions",
    },
    {
      kind: "column",
      schema: "public",
      table: "sba_policy_rules",
      name: "effective_date",
    },
    {
      kind: "column",
      schema: "public",
      table: "sba_policy_rules",
      name: "updated_at",
    },
  ]);
});

test("extractExpectedObjects: ALTER TABLE without schema prefix defaults to public", () => {
  const got = extractExpectedObjects([
    "ALTER TABLE ai_events ADD COLUMN model text;",
  ]);
  assert.deepEqual(got, [
    { kind: "column", schema: "public", table: "ai_events", name: "model" },
  ]);
});

test("extractExpectedObjects: CREATE OR REPLACE FUNCTION with schema", () => {
  const got = extractExpectedObjects([
    "CREATE OR REPLACE FUNCTION public.match_bank_policy_chunks(query_embedding vector, match_threshold float)\nRETURNS TABLE(...) AS $$ ... $$;",
  ]);
  assert.deepEqual(got, [
    { kind: "function", schema: "public", name: "match_bank_policy_chunks" },
  ]);
});

test("extractExpectedObjects: CREATE UNIQUE INDEX IF NOT EXISTS", () => {
  const got = extractExpectedObjects([
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_slug ON public.deals (slug);",
  ]);
  assert.deepEqual(got, [
    { kind: "index", schema: "public", name: "idx_deals_slug" },
  ]);
});

test("extractExpectedObjects: whitespace + newline variations", () => {
  const got = extractExpectedObjects([
    "create   table\n  if   not   exists\n    public.weird_spaces\n   (id uuid);",
  ]);
  assert.deepEqual(got, [
    { kind: "table", schema: "public", name: "weird_spaces" },
  ]);
});

test("extractExpectedObjects: multiple statements in input array", () => {
  const got = extractExpectedObjects([
    "CREATE TABLE a (id uuid);",
    "CREATE TABLE b (id uuid);",
    "CREATE INDEX idx_a_id ON a (id);",
  ]);
  assert.deepEqual(got, [
    { kind: "table", schema: "public", name: "a" },
    { kind: "table", schema: "public", name: "b" },
    { kind: "index", schema: "public", name: "idx_a_id" },
  ]);
});

test("extractExpectedObjects: empty input returns empty array", () => {
  assert.deepEqual(extractExpectedObjects([]), []);
  assert.deepEqual(extractExpectedObjects([""]), []);
  assert.deepEqual(extractExpectedObjects(["-- comment only"]), []);
});

test("extractExpectedObjects: ignores DROP / SELECT / INSERT statements", () => {
  const got = extractExpectedObjects([
    "DROP TABLE old_thing;",
    "SELECT * FROM deals;",
    "INSERT INTO deals (id) VALUES (gen_random_uuid());",
  ]);
  assert.deepEqual(got, []);
});

test("statementMentionsObject: column-kind requires both table and column names", () => {
  const stmt = "ALTER TABLE sba_policy_rules ADD COLUMN category text;";
  assert.equal(
    statementMentionsObject(stmt, {
      kind: "column",
      schema: "public",
      table: "sba_policy_rules",
      name: "category",
    }),
    true,
  );
  assert.equal(
    statementMentionsObject(stmt, {
      kind: "column",
      schema: "public",
      table: "other_table",
      name: "category",
    }),
    false,
  );
});

test("isAllowed: matches column kind by version + table + name", () => {
  const finding: DriftFinding = {
    migration_version: "20251227000010",
    migration_name: "fix_schema_mismatches",
    object: {
      kind: "column",
      schema: "public",
      table: "sba_policy_rules",
      name: "category",
    },
    status: "missing",
    source_statement: "...",
  };
  assert.equal(
    isAllowed(finding, [
      {
        migration_version: "20251227000010",
        object: {
          kind: "column",
          table: "sba_policy_rules",
          name: "category",
        },
        reason: "test",
      },
    ]),
    true,
  );
  assert.equal(
    isAllowed(finding, [
      {
        migration_version: "20251227000010",
        object: {
          kind: "column",
          table: "different_table",
          name: "category",
        },
        reason: "test",
      },
    ]),
    false,
  );
  assert.equal(
    isAllowed(finding, [
      {
        migration_version: "20990101",
        object: {
          kind: "column",
          table: "sba_policy_rules",
          name: "category",
        },
        reason: "test",
      },
    ]),
    false,
  );
});

test("isAllowed: matches table kind by version + name; ignores schema", () => {
  const finding: DriftFinding = {
    migration_version: "20251227000012",
    migration_name: "sba_god_mode_foundation",
    object: { kind: "table", schema: "public", name: "committee_personas" },
    status: "missing",
    source_statement: "...",
  };
  assert.equal(
    isAllowed(finding, [
      {
        migration_version: "20251227000012",
        object: { kind: "table", name: "committee_personas" },
        reason: "intentional",
      },
    ]),
    true,
  );
  assert.equal(
    isAllowed(finding, [
      {
        migration_version: "20251227000012",
        object: { kind: "index", name: "committee_personas" },
        reason: "wrong kind",
      },
    ]),
    false,
  );
});

test("isAllowed: empty allow-list never allows", () => {
  const finding: DriftFinding = {
    migration_version: "20260513",
    migration_name: "watchlist_workout",
    object: { kind: "table", schema: "public", name: "watchlist_entries" },
    status: "missing",
    source_statement: "...",
  };
  assert.equal(isAllowed(finding, []), false);
});
