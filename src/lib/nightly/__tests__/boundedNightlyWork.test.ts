import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("nightly retention commits bounded service-role-only batches", () => {
  const sql = read(
    "supabase/migrations/20260827080000_bounded_nightly_retention.sql",
  );

  assert.equal((sql.match(/LIMIT 5000/g) ?? []).length, 3);
  assert.equal((sql.match(/SET search_path = ''/g) ?? []).length, 3);
  assert.doesNotMatch(sql, /\bLOOP\b/);
  assert.doesNotMatch(sql, /pg_sleep/);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.purge_buddy_system_events\(int\)[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.purge_buddy_workers\(int\)[\s\S]*TO service_role/,
  );
});

test("nightly portfolio treats empty state explicitly without masking database faults", () => {
  const aggregate = read("src/lib/macro/aggregatePortfolio.ts");
  const route = read("src/app/api/cron/nightly/route.ts");

  assert.match(aggregate, /\{ data: snapshots, error: readError \}/);
  assert.match(aggregate, /if \(readError\)/);
  assert.match(
    aggregate,
    /if \(!snapshots \|\| snapshots\.length === 0\) \{\s*return null;/,
  );
  assert.match(aggregate, /if \(writeError\)/);
  assert.match(
    route,
    /const portfolio = await aggregatePortfolio\(bank\.id\)/,
  );
  assert.match(route, /skipped_no_final_decisions/);
  assert.match(route, /await detectPolicyDrift\(bank\.id\)/);
});
