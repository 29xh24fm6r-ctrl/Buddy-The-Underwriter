import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("IRS polling does not emit successful outcomes after Supabase failures", () => {
  const polling = read("src/lib/integrations/irsTranscripts/polling.ts");

  assert.match(polling, /pendingError/);
  assert.match(polling, /persistenceError\("load pending requests"\)/);
  assert.match(polling, /requireReturnedRow\(\s*"mark request received"/);
  assert.match(polling, /requireReturnedRow\(\s*"mark request expired"/);
  assert.match(polling, /requireReturnedRow\(\s*"persist delayed-transcript gap"/);
  assert.match(polling, /requireReturnedRow\(\s*"advance request polling cursor"/);
  assert.match(polling, /\.eq\("status", "submitted"\)/);
});

test("IRS reconciliation requires every authoritative read and write", () => {
  const reconciler = read("src/lib/integrations/irsTranscripts/reconciler.ts");
  const worker = read("src/lib/jobs/pollIrsTranscripts.ts");
  const route = read("src/app/api/cron/sba-checks/route.ts");

  assert.match(reconciler, /persistenceError\("load request"\)/);
  assert.match(reconciler, /persistenceError\("load borrower financial facts"\)/);
  assert.match(reconciler, /persistenceError\("persist discrepancy gaps"\)/);
  assert.match(reconciler, /persistenceError\("mark request reconciled"\)/);
  assert.match(reconciler, /persistenceError\("persist completion event"\)/);
  assert.match(worker, /failures\.push/);
  assert.match(worker, /PERSISTENCE_FAILED/);
  assert.match(route, /getCronOutcome\(result\.failed\)/);
});

test("E-Tran and template checks distinguish failed reads from empty evidence", () => {
  const etran = read("src/lib/jobs/etranCertExpiryChecker.ts");
  const templates = read("src/lib/jobs/templateStalenessChecker.ts");

  assert.match(etran, /etran_cert_expiry_read_failed/);
  assert.match(templates, /template_staleness_read_failed/);
  assert.match(templates, /template_staleness_write_failed/);
});
