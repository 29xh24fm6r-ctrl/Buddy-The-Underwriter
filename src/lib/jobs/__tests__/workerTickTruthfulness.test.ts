import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  isWorkerStepFailure,
  publicWorkerStepResult,
  workerTickStatus,
} from "../workerTickOutcome";

test("idle queue is not classified as a failed worker step", () => {
  assert.equal(isWorkerStepFailure({ ok: false, idle: true }), false);
  assert.deepEqual(publicWorkerStepResult("OCR", { ok: false, idle: true }), {
    type: "OCR",
    ok: true,
    idle: true,
  });
});

test("successful worker step preserves its non-sensitive evidence", () => {
  assert.equal(isWorkerStepFailure({ ok: true, processed: 2 }), false);
  assert.deepEqual(publicWorkerStepResult("SPREADS", { ok: true, processed: 2 }), {
    type: "SPREADS",
    ok: true,
    processed: 2,
  });
});

test("failed worker step is non-green and redacts provider/database detail", () => {
  const result = { ok: false, error: "password=secret database unavailable" };
  assert.equal(isWorkerStepFailure(result), true);
  assert.deepEqual(publicWorkerStepResult("SPREAD_JANITOR", result), {
    type: "SPREAD_JANITOR",
    ok: false,
    error: "worker_step_failed",
  });
});

test("worker tick status is 503 whenever any child step failed", () => {
  assert.equal(workerTickStatus(0), 200);
  assert.equal(workerTickStatus(1), 503);
  assert.equal(workerTickStatus(5), 503);
});

test("all queue discovery paths distinguish database failure from idle", () => {
  for (const relative of [
    "src/lib/jobs/processors/ocrProcessor.ts",
    "src/lib/jobs/processors/classifyProcessor.ts",
    "src/lib/jobs/processors/extractProcessor.ts",
    "src/lib/jobs/processors/spreadsProcessor.ts",
  ]) {
    const source = fs.readFileSync(path.join(process.cwd(), relative), "utf8");
    assert.match(source, /data: jobs, error: queueError/);
    assert.match(source, /if \(queueError\)/);
    assert.match(source, /error: "queue_discovery_failed"/);
    assert.ok(source.indexOf("if (queueError)") < source.indexOf("if (!jobs || jobs.length === 0)"));
  }
});

test("composite route records every critical child failure and returns derived status", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/jobs/worker/tick/route.ts"),
    "utf8",
  );
  for (const step of [
    "DOC_JOB_STUCK_JOBS",
    "OCR",
    "CLASSIFY",
    "EXTRACT",
    "SPREADS",
    "SPREAD_STUCK_JOBS",
    "SPREAD_JANITOR",
    "STALE_RESEARCH_MISSIONS",
  ]) {
    assert.match(source, new RegExp(`recordFailure\\("${step}"`));
  }
  assert.match(source, /status: workerTickStatus\(failedSteps\)/);
  assert.match(source, /status: workerTickStatus\(spreadFailures\)/);
});
