/**
 * SPEC-PORTAL-1 §5.2 — guard-internal-links fixture tests.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-internal-links.mjs");
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
      LINK_GUARD_APP_DIR: path.join(root, "app"),
      LINK_GUARD_SRC_DIR: path.join(root, "src"),
      LINK_GUARD_ALLOWLIST: allowlist,
    },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-links-"));
  // Real routes: /exists and /deals/[dealId]
  write("app/exists/page.tsx", "export default function P(){return null}");
  write("app/deals/[dealId]/page.tsx", "export default function P(){return null}");
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("guard-internal-links", () => {
  it("passes a link to an existing route", () => {
    write("src/a.tsx", `<Link href="/exists">go</Link>`);
    const r = run([]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("resolves a dynamic-param link via router.push", () => {
    write("src/a.tsx", `router.push("/deals/deal-123")`);
    const r = run([]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("fails a link to a nonexistent route", () => {
    write("src/a.tsx", `<Link href="/nonexistent">x</Link>`);
    const r = run([]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\/nonexistent/);
  });

  it("passes a nonexistent route when allowlisted", () => {
    write("src/a.tsx", `<Link href="/nonexistent">x</Link>`);
    const r = run(["/nonexistent"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("skips template-literal (dynamic) links entirely", () => {
    write("src/a.tsx", "<Link href={`/deals/${id}/whatever-not-a-route`}>x</Link>");
    const r = run([]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
