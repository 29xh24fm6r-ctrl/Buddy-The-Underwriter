/**
 * SPEC-PORTAL-1 §5.3 — fetch-guard now scans j()/useSWR() wrappers.
 * Regression against the original audit-defeating pattern (a dead-route call
 * hidden inside a `j()` JSON wrapper escaped the fetch/axios-only needle).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../../check-client-api-fetches.mjs");
let root: string;

function write(rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function run() {
  return spawnSync("node", [GUARD], {
    encoding: "utf8",
    env: { ...process.env, FETCH_GUARD_SRC_DIR: root },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-guard-"));
  // One real route: /api/live
  write("app/api/live/route.ts", "export function GET(){ return new Response('ok'); }");
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("fetch-guard wrapper coverage", () => {
  it("catches a dead route hidden in a j() wrapper", () => {
    write("client.tsx", "async function f(){ await j('/api/dead', { method: 'POST' }); }");
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\/api\/dead/);
    fs.rmSync(path.join(root, "client.tsx"));
  });

  it("catches a dead route hidden in a useSWR() wrapper", () => {
    write("client.tsx", `const { data } = useSWR("/api/ghost", fetcher);`);
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\/api\/ghost/);
    fs.rmSync(path.join(root, "client.tsx"));
  });

  it("passes a live route reached through a j() wrapper", () => {
    write("client.tsx", "async function f(){ await j('/api/live', {}); }");
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    fs.rmSync(path.join(root, "client.tsx"));
  });

  it("does not match identifiers like obj( or json(", () => {
    write("client.tsx", "const x = json('/api/dead'); const y = obj('/api/dead');");
    const r = run();
    assert.equal(r.status, 0, `obj(/json( must not be treated as the j() wrapper\n${r.stderr}`);
    fs.rmSync(path.join(root, "client.tsx"));
  });
});
