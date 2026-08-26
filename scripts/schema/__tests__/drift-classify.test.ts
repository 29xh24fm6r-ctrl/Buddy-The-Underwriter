import assert from "node:assert/strict";
import test from "node:test";

import { classifyDriftFindings } from "../drift-classify";
import type { DriftFinding } from "../drift-detect";

function finding(
  migrationVersion: string,
  object: DriftFinding["object"],
): DriftFinding {
  return {
    migration_version: migrationVersion,
    migration_name: `migration_${migrationVersion}`,
    object,
    status: "missing",
    source_statement: "ddl",
  };
}

test("classification collapses repeated historical expectations", () => {
  const object = { kind: "table", schema: "public", name: "deals" } as const;
  const result = classifyDriftFindings([
    finding("20250101", object),
    finding("20250201", object),
  ]);

  assert.equal(result.raw_findings, 2);
  assert.equal(result.unique_objects, 1);
  assert.equal(result.duplicate_expectations, 1);
  assert.equal(result.duplicate_objects, 1);
  assert.equal(result.items[0].occurrences.length, 2);
});

test("classification marks columns and indexes as dependent when their table is missing", () => {
  const result = classifyDriftFindings([
    finding("20250101", {
      kind: "table",
      schema: "public",
      name: "deals",
    }),
    finding("20250102", {
      kind: "column",
      schema: "public",
      table: "deals",
      name: "status",
    }),
    finding("20250103", {
      kind: "index",
      schema: "public",
      name: "deals_status_idx",
      table_schema: "public",
      table: "deals",
    }),
  ]);

  assert.deepEqual(result.by_triage_class, {
    missing_table: 1,
    dependent_on_missing_table: 2,
    missing_column: 0,
    missing_index: 0,
    missing_function: 0,
  });
  assert.equal(result.independently_actionable_objects, 1);
  assert.equal(
    result.items.find((item) => item.object.kind === "column")?.depends_on,
    "table:public.deals",
  );
});

test("classification leaves objects on present tables independently actionable", () => {
  const result = classifyDriftFindings([
    finding("20250101", {
      kind: "column",
      schema: "public",
      table: "deals",
      name: "status",
    }),
    finding("20250102", {
      kind: "index",
      schema: "public",
      name: "deals_status_idx",
      table_schema: "public",
      table: "deals",
    }),
    finding("20250103", {
      kind: "function",
      schema: "public",
      name: "touch_deal",
    }),
  ]);

  assert.deepEqual(result.by_triage_class, {
    missing_table: 0,
    dependent_on_missing_table: 0,
    missing_column: 1,
    missing_index: 1,
    missing_function: 1,
  });
  assert.equal(result.independently_actionable_objects, 3);
});

test("classification is deterministic regardless of input order", () => {
  const a = finding("20250101", {
    kind: "function",
    schema: "public",
    name: "alpha",
  });
  const b = { ...a, source_statement: "second ddl" };
  a.source_statement = "first ddl";

  assert.deepEqual(
    classifyDriftFindings([a, b]),
    classifyDriftFindings([b, a]),
  );
});
