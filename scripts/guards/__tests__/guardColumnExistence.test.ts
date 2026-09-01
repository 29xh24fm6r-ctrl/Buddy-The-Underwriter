/**
 * Fixture tests for guard-column-existence.
 *
 * The guard only earns its keep if it flags the exact shapes that have bitten
 * this repo (a stale select column, a stale filter column) while staying quiet
 * on the PostgREST syntax that merely looks like one — embedded resources,
 * aliases, JSON paths, and dynamic specs it cannot read.
 */
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-column-existence.mjs");

const SCHEMA = {
  deals: ["id", "loan_amount", "bank_id", "metadata"],
  crm_organizations: ["id", "name", "state_code"],
};

let root: string;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "column-guard-"));
  fs.writeFileSync(path.join(root, "schema.json"), JSON.stringify(SCHEMA), "utf8");
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(path.join(root, "src"), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
});

function write(rel: string, body: string) {
  const abs = path.join(root, "src", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function run(baseline?: string[]) {
  const baselinePath = path.join(root, "baseline.txt");
  fs.writeFileSync(baselinePath, (baseline ?? []).join("\n") + "\n", "utf8");
  return spawnSync("node", [GUARD], {
    encoding: "utf8",
    env: {
      ...process.env,
      COLUMN_GUARD_SRC_DIR: path.join(root, "src"),
      COLUMN_GUARD_SCHEMA: path.join(root, "schema.json"),
      COLUMN_GUARD_BASELINE: baselinePath,
    },
  });
}

describe("guard-column-existence", () => {
  it("fails on a select column the table does not have", () => {
    write("a.ts", `sb.from("deals").select("id, amount")`);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /deals\.amount/);
    assert.match(r.stderr, /a\.ts:1/);
  });

  it("fails on a filter column the table does not have", () => {
    write("a.ts", `sb.from("deals").select("id").eq("amount", 5)`);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /deals\.amount/);
  });

  it("passes on columns that exist", () => {
    write("a.ts", `sb.from("deals").select("id, loan_amount").eq("bank_id", b).order("id")`);
    assert.equal(run().status, 0);
  });

  it("attributes embedded resource columns to the related table", () => {
    write("ok.ts", `sb.from("deals").select("id, org:crm_organizations(name, state_code)")`);
    assert.equal(run().status, 0);

    write("bad.ts", `sb.from("deals").select("id, org:crm_organizations(nope)")`);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /crm_organizations\.nope/);
    assert.doesNotMatch(r.stderr, /deals\.nope/);
  });

  it("does not let one chain's select bleed onto the previous table", () => {
    write("a.ts", `sb.from("crm_organizations").select("id");\nsb.from("deals").select("loan_amount");`);
    assert.equal(run().status, 0);
  });

  it("ignores aliases, JSON paths, casts, and star selects", () => {
    write("a.ts", `sb.from("deals").select("*, total:loan_amount, metadata->>ticket, id::text")`);
    assert.equal(run().status, 0);
  });

  it("stays silent on specs it cannot read rather than guessing", () => {
    write("a.ts", "sb.from(\"deals\").select(`id, ${extra}`).eq(col, 1)");
    assert.equal(run().status, 0);
  });

  it("skips tables that are not in the schema snapshot", () => {
    write("a.ts", `sb.from("some_other_service_table").select("whatever")`);
    assert.equal(run().status, 0);
  });

  it("skips test files", () => {
    write("__tests__/a.test.ts", `sb.from("deals").select("amount")`);
    assert.equal(run().status, 0);
  });

  it("allows a baselined break but reports it as still baselined", () => {
    write("a.ts", `sb.from("deals").select("amount")`);
    const r = run(["deals.amount"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /1 baselined/);
  });

  it("fails when a baseline entry is no longer referenced, keeping it remove-only", () => {
    write("a.ts", `sb.from("deals").select("loan_amount")`);
    const r = run(["deals.amount"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /stale baseline/);
    assert.match(r.stderr, /deals\.amount/);
  });

  it("ignores comments in the baseline file", () => {
    write("a.ts", `sb.from("deals").select("amount")`);
    const r = run(["# a note", "deals.amount  # why"]);
    assert.equal(r.status, 0);
  });
});
