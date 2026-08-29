import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detector = readFileSync("src/lib/storage/orphanDetector.ts", "utf8");
const route = readFileSync(
  "src/app/api/admin/orphans/run/route.ts",
  "utf8",
);

test("GCS and Supabase listings prove completeness before reconciliation", () => {
  assert.match(detector, /maxResults:\s*maxObjects \+ 1/);
  assert.match(detector, /files\.length > maxObjects/);
  assert.match(detector, /files\.slice\(0, maxObjects\)/);
  assert.match(detector, /for \(let offset = 0; ; offset \+= 1000\)/);
  assert.match(detector, /offset,/);
  assert.match(detector, /if \(items\.length < 1000\) break/);
});

test("incomplete scans cannot emit authoritative orphan findings", () => {
  const capGuard = route.indexOf("if (capped)");
  const cacheRead = route.indexOf("const storageCache");
  const findingInsert = route.indexOf("await insertFindings");

  assert.ok(capGuard >= 0, "missing capped scan guard");
  assert.ok(cacheRead > capGuard, "cache reconciliation must follow cap guard");
  assert.ok(
    findingInsert > cacheRead,
    "finding persistence must follow complete reconciliation",
  );
  assert.match(route, /throw new IncompleteScanError/);
  assert.match(route, /status:\s*"failed"/);
  assert.match(route, /status:\s*409/);
  assert.doesNotMatch(route, /\.slice\(0, 50000\)/);
  assert.doesNotMatch(route, /\.limit\(100000\)|\.limit\(200000\)/);
});

test("scan scope and resource use are validated before a run starts", () => {
  const requestParse = route.indexOf("parseScanRequest(body)");
  const runInsert = route.indexOf('.from("storage_scan_runs")');

  assert.ok(requestParse >= 0);
  assert.ok(runInsert > requestParse);
  assert.match(route, /maxObjects > MAX_OBJECTS/);
  assert.match(route, /prefix\.includes\("\.\."\)/);
  assert.match(route, /invalid_prefix/);
  assert.match(route, /invalid_bucket/);
  assert.match(route, /invalid_max_objects/);
  assert.match(route, /MAX_RECONCILIATION_ROWS/);
  assert.match(route, /MAX_FINDINGS_PER_KIND/);
});

test("success requires returned-row proof and preserves scan timestamps", () => {
  assert.match(route, /completedAt/);
  assert.match(route, /startedAt,/);
  assert.match(
    route,
    /\.update\(\{[\s\S]*?status:\s*"success"[\s\S]*?\}\)\s*\.eq\("id", runId\)\s*\.select\("id, status"\)\s*\.single\(\)/,
  );
  assert.match(route, /completed\.data\?\.status !== "success"/);
  assert.match(route, /failed\.data\?\.status !== "failed"/);
});

test("the unscoped exec_sql orphan implementation is removed", () => {
  assert.doesNotMatch(detector, /computeOrphansFromCache/);
  assert.doesNotMatch(detector, /exec_sql/);
  assert.doesNotMatch(detector, /split_part/);
});
