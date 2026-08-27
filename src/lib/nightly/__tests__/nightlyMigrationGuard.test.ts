import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20260827112000_nightly_governance_convergence.sql",
  ),
  "utf8",
);
const route = fs.readFileSync(
  path.join(root, "src/app/api/cron/nightly/route.ts"),
  "utf8",
);

test("retention migration makes each RPC one bounded service-role-only batch", () => {
  assert.doesNotMatch(migration, /\bLOOP\b/);
  assert.equal((migration.match(/LIMIT 1000/g) ?? []).length, 3);
  assert.equal(
    (migration.match(/GRANT EXECUTE ON FUNCTION public\.purge_/g) ?? []).length,
    3,
  );
  assert.equal(
    (migration.match(/REVOKE ALL ON FUNCTION public\.purge_/g) ?? []).length,
    3,
  );
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
});

test("nightly route delegates per-bank classification to the tested factory", () => {
  assert.match(route, /runBankNightlyTasks\(bank\.id\)/);
  assert.doesNotMatch(route, /aggregatePortfolio\(bank\.id\)/);
  assert.match(route, /telemetry_retention_incomplete/);
});
