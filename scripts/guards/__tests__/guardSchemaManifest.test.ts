/**
 * SPEC-DRIFT-HARDENING-1 D3 — guard-schema-manifest fixture tests.
 */
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-schema-manifest.ts");
let root: string;
let migrationsDir: string;
let manifestPath: string;

function writeMigration(name: string, body: string) {
  fs.writeFileSync(path.join(migrationsDir, name), body, "utf8");
}

function writeManifest(entries: unknown[]) {
  fs.writeFileSync(manifestPath, JSON.stringify(entries), "utf8");
}

function run() {
  return spawnSync("node", ["--import", "tsx", GUARD], {
    encoding: "utf8",
    env: {
      ...process.env,
      SCHEMA_MANIFEST_MIGRATIONS_DIR: migrationsDir,
      SCHEMA_MANIFEST_PATH: manifestPath,
    },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-schema-manifest-"));
  migrationsDir = path.join(root, "migrations");
  manifestPath = path.join(root, "manifest.json");
});
beforeEach(() => {
  fs.rmSync(migrationsDir, { recursive: true, force: true });
  fs.mkdirSync(migrationsDir, { recursive: true });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("guard-schema-manifest", () => {
  it("passes when every created object has a manifest entry", () => {
    writeMigration(
      "20260729000000_ai_gateway_calls.sql",
      "CREATE TABLE IF NOT EXISTS public.ai_gateway_calls (id uuid PRIMARY KEY);",
    );
    writeManifest([
      { name: "ai_gateway_calls", type: "table", migration: "20260729000000_ai_gateway_calls.sql" },
    ]);
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 missing/);
  });

  it("fails when a migration creates a table with no manifest entry", () => {
    writeMigration(
      "20260729000001_unregistered_table.sql",
      "CREATE TABLE IF NOT EXISTS public.some_new_table (id uuid PRIMARY KEY);",
    );
    writeManifest([]);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /some_new_table/);
    assert.match(r.stderr, /20260729000001_unregistered_table\.sql/);
  });

  it("ignores migrations before the cutoff version entirely", () => {
    writeMigration(
      "20260101000000_pre_cutoff_table.sql",
      "CREATE TABLE IF NOT EXISTS public.pre_cutoff_table (id uuid PRIMARY KEY);",
    );
    writeManifest([]);
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("ignores bare 8-digit Workflow A filenames (no full 14-digit prefix)", () => {
    writeMigration(
      "20260326_some_workflow_a_file.sql",
      "CREATE TABLE IF NOT EXISTS public.workflow_a_table (id uuid PRIMARY KEY);",
    );
    writeManifest([]);
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
