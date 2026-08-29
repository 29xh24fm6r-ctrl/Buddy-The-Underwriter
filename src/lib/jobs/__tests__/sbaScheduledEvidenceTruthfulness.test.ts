import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("IRS polling does not emit successful outcomes after Supabase failures", () => {
  const polling = read("src/lib/integrations/irsTranscripts/polling.ts");

  assert.match(polling, /pendingError/);
  assert.match(polling, /dbError\("pending_read"/);
  assert.match(polling, /received_update/);
  assert.match(polling, /expired_update/);
  assert.match(polling, /expiry_gap_insert/);
  assert.match(polling, /pending_update/);
});

test("IRS reconciliation requires every authoritative read and write", () => {
  const reconciler = read("src/lib/integrations/irsTranscripts/reconciler.ts");
  const worker = read("src/lib/jobs/pollIrsTranscripts.ts");
  const route = read("src/app/api/cron/sba-checks/route.ts");

  assert.match(reconciler, /request_read/);
  assert.match(reconciler, /facts_read/);
  assert.match(reconciler, /gap_insert/);
  assert.match(reconciler, /request_update/);
  assert.match(reconciler, /event_insert/);
  assert.match(worker, /failed\+\+/);
  assert.match(route, /getCronOutcome\(result\.failed\)/);
});

test("E-Tran and template checks distinguish failed reads from empty evidence", () => {
  const etran = read("src/lib/jobs/etranCertExpiryChecker.ts");
  const templates = read("src/lib/jobs/templateStalenessChecker.ts");

  assert.match(etran, /etran_cert_expiry_read_failed/);
  assert.match(templates, /template_staleness_read_failed/);
  assert.match(templates, /template_staleness_write_failed/);
});
