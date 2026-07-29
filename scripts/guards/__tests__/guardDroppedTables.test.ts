/**
 * SPEC-SYSTEM-DEBLOAT-1 Phase C2/C3 — guard-dropped-tables fixture tests.
 */
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-dropped-tables.mjs");
let root: string;

function write(rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

// Each test writes fixture files under src/ and/or services/ — reset both
// before every test so one test's leftover file can't be picked up by a
// later test scanning the same directories.
beforeEach(() => {
  for (const d of ["src", "services"]) {
    fs.rmSync(path.join(root, d), { recursive: true, force: true });
  }
});

function run(droppedTables: string[]) {
  const ddlDir = path.join(root, "dropped-ddl");
  fs.mkdirSync(ddlDir, { recursive: true });
  for (const f of fs.readdirSync(ddlDir)) fs.rmSync(path.join(ddlDir, f));
  for (const t of droppedTables) {
    fs.writeFileSync(path.join(ddlDir, `${t}.sql`), `-- stub DDL for ${t}\n`, "utf8");
  }
  return spawnSync("node", [GUARD], {
    encoding: "utf8",
    env: {
      ...process.env,
      DROPPED_TABLES_REPO_ROOT: root,
      DROPPED_TABLES_SCAN_DIRS: "src,services",
      DROPPED_TABLES_DDL_DIR: ddlDir,
    },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-dropped-tables-"));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("guard-dropped-tables", () => {
  it("passes with zero dropped tables tracked", () => {
    const r = run([]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 dropped tables tracked yet/);
  });

  it("passes when no reference to a dropped table exists", () => {
    write("src/a.ts", `await sb.from("still_live_table").select("*");`);
    const r = run(["xp_logs"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("fails when src/ references a dropped table", () => {
    write("src/a.ts", `await sb.from("xp_logs").insert({});`);
    const r = run(["xp_logs"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /xp_logs/);
  });

  it("fails when services/ references a dropped table (not just src/)", () => {
    write("services/worker/a.ts", `await sb.from("tenants").select("id");`);
    const r = run(["tenants"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /tenants/);
  });

  it("does not false-positive on a similarly-named live table", () => {
    write("src/a.ts", `await sb.from("tenants_v2").select("*");`);
    const r = run(["tenants"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
