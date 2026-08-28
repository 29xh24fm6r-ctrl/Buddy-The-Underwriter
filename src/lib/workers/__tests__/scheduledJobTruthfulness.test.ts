import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("borrower reminders use the shared worker boundary and expose partial failure", () => {
  const route = read("src/app/api/cron/borrower-reminders/route.ts");

  assert.match(route, /hasValidWorkerSecret\(req\)/);
  assert.doesNotMatch(route, /token\s*!==\s*process\.env\.CRON_SECRET/);
  assert.match(route, /getCronOutcome\(failed\)/);
  assert.match(route, /status:\s*outcome\.status/);
});

test("SBA checks fail the invocation when reconciliation is incomplete", () => {
  const route = read("src/app/api/cron/sba-checks/route.ts");

  assert.match(route, /getCronOutcome\(result\.failed\)/);
  assert.match(route, /getCronOutcome\(failed\.length\)/);
  assert.match(route, /status:\s*outcome\.status/g);
});

test("nightly governance exposes discovery and partial-work failures", () => {
  const route = read("src/app/api/cron/nightly/route.ts");

  assert.match(route, /data:\s*banks,\s*error:\s*banksError/);
  assert.match(route, /error:\s*"banks_query_failed"/);
  assert.match(route, /failedBanks\s*\+\s*Number\(!retention\.ok\)/);
  assert.match(route, /status:\s*outcome\.status/g);
});
