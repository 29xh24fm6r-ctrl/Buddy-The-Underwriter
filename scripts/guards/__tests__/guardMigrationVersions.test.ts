/**
 * SPEC-DRIFT-HARDENING-1 D2 — guard-migration-versions fixture tests.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-migration-versions.mjs");
let root: string;

function run(filenames: string[]) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const f of filenames) {
    fs.writeFileSync(path.join(root, f), "-- stub\n", "utf8");
  }
  return spawnSync("node", [GUARD], {
    encoding: "utf8",
    env: { ...process.env, MIGRATION_VERSIONS_DIR: root },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-migration-versions-"));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("guard-migration-versions", () => {
  it("passes with no full-timestamp duplicates", () => {
    const r = run([
      "20260729000000_ai_gateway_calls.sql",
      "20260729000010_telemetry_retention.sql",
    ]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 duplicates/);
  });

  // The exact 2026-07-30 incident this guard was built to catch.
  it("fails when two files share a full 14-digit timestamp", () => {
    const r = run([
      "20260729000000_ai_gateway_calls.sql",
      "20260729000000_telemetry_retention.sql",
    ]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /20260729000000/);
    assert.match(r.stderr, /ai_gateway_calls\.sql/);
    assert.match(r.stderr, /telemetry_retention\.sql/);
  });

  it("does not false-positive on bare 8-digit Workflow A files sharing a date", () => {
    const r = run([
      "20260326_auto_intelligence_pipeline.sql",
      "20260326_another_same_day_file.sql",
      "20260326_yet_another_same_day_file.sql",
    ]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("passes with an empty migrations directory", () => {
    const r = run([]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
