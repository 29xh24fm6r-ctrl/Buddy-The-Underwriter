/**
 * SPEC-PORTAL-1 §5.1 — guard-rpc-existence fixture tests.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-rpc-existence.mjs");
let root: string;

function write(rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function run(allowlistLines: string[]) {
  const allowlist = path.join(root, "allow.txt");
  fs.writeFileSync(allowlist, allowlistLines.join("\n") + "\n", "utf8");
  return spawnSync("node", [GUARD], {
    encoding: "utf8",
    env: {
      ...process.env,
      RPC_GUARD_MIGRATIONS_DIR: path.join(root, "migrations"),
      RPC_GUARD_SRC_DIR: path.join(root, "src"),
      RPC_GUARD_ALLOWLIST: allowlist,
    },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-rpc-"));
  write(
    "migrations/0001_init.sql",
    "create or replace function public.exists_in_migration(p_token text)\nreturns void as $$ begin end; $$ language plpgsql;",
  );
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("guard-rpc-existence", () => {
  it("passes when the rpc is migration-defined", () => {
    write("src/a.ts", `await sb.rpc("exists_in_migration", { p_token: t });`);
    const r = run([]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("fails on a phantom rpc with no migration + no allowlist", () => {
    write("src/a.ts", `await sb.rpc("phantom_rpc", {});`);
    const r = run([]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /phantom_rpc/);
  });

  it("passes when an absent rpc is allowlisted", () => {
    write("src/a.ts", `await sb.rpc("pg_builtin_thing", {});`);
    const r = run(["pg_builtin_thing"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("does not fail on a ghost allowlist entry (remove-only, no false-block)", () => {
    write("src/a.ts", `await sb.rpc("exists_in_migration", {});`);
    const r = run(["ghost_never_called"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
