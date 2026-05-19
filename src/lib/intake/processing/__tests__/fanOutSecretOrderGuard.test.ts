/**
 * Source-level guards for SPEC-WORKER-SECRET-FANOUT-AUTH-1.
 *
 * Application-initiated worker invocations (fan-out from processConfirmedIntake
 * and the reprocess handleExtractAll path) must prefer WORKER_SECRET over
 * CRON_SECRET. Vercel auto-injects CRON_SECRET as an Authorization header on
 * cron invocations but does NOT expose it via process.env to non-cron-triggered
 * routes — so the old `CRON_SECRET ?? WORKER_SECRET` chain resolved to "".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const READ = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

test("[fanout-secret-1] processConfirmedIntake uses WORKER_SECRET before CRON_SECRET", () => {
  const src = READ("src/lib/intake/processing/processConfirmedIntake.ts");
  assert.match(
    src,
    /process\.env\.WORKER_SECRET\s*\?\?\s*process\.env\.CRON_SECRET/,
    "processConfirmedIntake must resolve WORKER_SECRET before CRON_SECRET",
  );
  assert.doesNotMatch(
    src,
    /process\.env\.CRON_SECRET\s*\?\?\s*process\.env\.WORKER_SECRET/,
    "old CRON_SECRET-first pattern must be removed",
  );
});

test("[fanout-secret-2] handleExtractAll uses WORKER_SECRET before CRON_SECRET", () => {
  const src = READ("src/app/api/deals/[dealId]/reprocess/route.ts");
  assert.match(
    src,
    /process\.env\.WORKER_SECRET\s*\?\?\s*process\.env\.CRON_SECRET/,
  );
  assert.doesNotMatch(
    src,
    /process\.env\.CRON_SECRET\s*\?\?\s*process\.env\.WORKER_SECRET/,
  );
});

test("[fanout-secret-3] auth-probe route exists and is auth-gated", () => {
  const src = READ("src/app/api/workers/[...path]/_handlers/auth-probe.ts");
  assert.match(src, /hasValidWorkerSecret/);
  assert.match(src, /env_presence/);
  // Negative check: auth-probe must never expose raw secret values —
  // every reference to *_SECRET should be wrapped in Boolean() (or be inside
  // a comment/docstring).
  const codeOnly = src
    // Strip block + line comments to avoid false positives in the file header.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(
    codeOnly,
    /process\.env\.(CRON|WORKER)_SECRET(?!\s*\))/,
    "auth-probe must never reference raw secret values outside Boolean()",
  );
});
