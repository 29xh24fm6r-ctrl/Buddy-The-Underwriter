/**
 * SPEC-SEC-1 — guard-deal-route-access.mjs fixture tests.
 *
 * Exercises the guard against a temp fixture tree via child_process, driving
 * the env overrides (BASE / ROOT / ALLOWLIST). Covers:
 *   a) admin + assertDealAccess          → pass (not failing)
 *   b) admin, no assert, not allowlisted  → fail
 *   c) BORROWER_TOKEN-marked + validator  → pass
 *   d) WORKER-marked + worker secret      → pass
 *   e) allowlisted unpatched route        → pass
 *   f) stale allowlist (ghost) entry      → fail
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-deal-route-access.mjs");

let root: string;

function writeRoute(rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function runGuard(allowlistLines: string[]) {
  const allowlistPath = path.join(root, "allowlist.txt");
  fs.writeFileSync(allowlistPath, allowlistLines.join("\n") + "\n", "utf8");
  return spawnSync("node", [GUARD], {
    encoding: "utf8",
    env: {
      ...process.env,
      DEAL_ROUTE_GUARD_BASE: root,
      DEAL_ROUTE_GUARD_ROOT: root,
      DEAL_ROUTE_GUARD_ALLOWLIST: allowlistPath,
    },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-deal-route-"));
  // a) protected via assertDealAccess
  writeRoute(
    "protected/route.ts",
    `import { supabaseAdmin } from "x";\nimport { assertDealAccess } from "y";\nawait assertDealAccess(dealId);\nsupabaseAdmin();`,
  );
  // b) unpatched — supabaseAdmin only
  writeRoute("unpatched/route.ts", `import { supabaseAdmin } from "x";\nsupabaseAdmin();`);
  // c) BORROWER_TOKEN with validator
  writeRoute(
    "token/route.ts",
    `// route-class: BORROWER_TOKEN\nimport { supabaseAdmin } from "x";\nawait resolvePortalToken(t);\nsupabaseAdmin();`,
  );
  // d) WORKER with secret
  writeRoute(
    "worker/route.ts",
    `// route-class: WORKER\nimport { supabaseAdmin } from "x";\nif (h !== process.env.WORKER_SECRET) return;\nsupabaseAdmin();`,
  );
  // e) another unpatched route we will allowlist
  writeRoute("allowed/route.ts", `import { supabaseAdmin } from "x";\nsupabaseAdmin();`);
  // A route with no supabaseAdmin at all — out of scope, never counted.
  writeRoute("noadmin/route.ts", `export const GET = () => new Response("ok");`);
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("guard-deal-route-access fixtures", () => {
  it("passes when every failing route is allowlisted (assert/token/worker not required to be)", () => {
    const res = runGuard(["unpatched/route.ts", "allowed/route.ts"]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /guard passed/);
  });

  it("fails when an unpatched route is not allowlisted", () => {
    const res = runGuard(["allowed/route.ts"]); // missing unpatched/route.ts
    assert.equal(res.status, 1);
    assert.match(res.stderr, /unpatched\/route\.ts/);
  });

  it("fails on a stale allowlist entry (protected route on the list)", () => {
    // protected/route.ts does not fail the base check, so listing it is stale.
    const res = runGuard(["unpatched/route.ts", "allowed/route.ts", "protected/route.ts"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /stale allowlist/i);
    assert.match(res.stderr, /protected\/route\.ts/);
  });

  it("fails on a ghost allowlist entry (path does not exist)", () => {
    const res = runGuard(["unpatched/route.ts", "allowed/route.ts", "ghost/route.ts"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /ghost\/route\.ts/);
  });

  it("BORROWER_TOKEN + WORKER marked routes never appear as failing", () => {
    // With only the two genuinely-unpatched routes allowlisted, guard passes —
    // proving token/route.ts and worker/route.ts are treated as protected.
    const res = runGuard(["unpatched/route.ts", "allowed/route.ts"]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
  });
});
