/**
 * SPEC-SEC-API-AUTH-1 — guard-api-route-auth.mjs fixture tests.
 *
 * Drives the guard against a temp fixture tree via child_process using the
 * env overrides (BASE / ROOT / ALLOWLIST). Covers:
 *   a) supabaseAdmin + a recognised auth helper       → pass
 *   b) supabaseAdmin with no auth at all              → fail
 *   c) supabaseAdmin + documented PUBLIC marker       → pass
 *   d) a bare PUBLIC marker with no reason            → fail (reason required)
 *   e) no supabaseAdmin (RLS-scoped client only)      → out of scope, pass
 *   f) inline token lookup (.eq("access_token", …))   → pass
 *   g) allowlisted unpatched route                    → pass
 *   h) stale allowlist entry                          → fail (remove-only)
 *   i) routes under deals/[dealId] are skipped        → pass (other guard owns them)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = path.resolve(__dirname, "../guard-api-route-auth.mjs");

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
      API_AUTH_GUARD_BASE: root,
      API_AUTH_GUARD_ROOT: root,
      API_AUTH_GUARD_ALLOWLIST: allowlistPath,
    },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-api-auth-"));

  writeRoute(
    "authed/route.ts",
    `import { supabaseAdmin } from "x";\nconst a = await ensureDealBankAccess(dealId);\nsupabaseAdmin();`,
  );
  writeRoute("naked/route.ts", `import { supabaseAdmin } from "x";\nsupabaseAdmin();`);
  writeRoute(
    "public-documented/route.ts",
    `// route-class: PUBLIC — franchise reference data, no tenant scope\nimport { supabaseAdmin } from "x";\nsupabaseAdmin();`,
  );
  writeRoute(
    "public-bare/route.ts",
    `// route-class: PUBLIC\nimport { supabaseAdmin } from "x";\nsupabaseAdmin();`,
  );
  writeRoute("rls-only/route.ts", `import { getSupabaseServerClient } from "x";\nawait getSupabaseServerClient();`);
  writeRoute(
    "inline-token/route.ts",
    `import { supabaseAdmin } from "x";\nsupabaseAdmin().from("applications").eq("access_token", token);`,
  );
  // Owned by guard-deal-route-access.mjs — must be skipped here even though
  // it would otherwise fail the base check.
  writeRoute(
    "src/app/api/deals/[dealId]/thing/route.ts",
    `import { supabaseAdmin } from "x";\nsupabaseAdmin();`,
  );
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("guard-api-route-auth", () => {
  it("passes a route that uses a recognised auth mechanism", () => {
    const r = runGuard(["naked/route.ts", "public-bare/route.ts"]);
    assert.ok(!r.stderr.includes("authed/route.ts"), r.stderr);
  });

  it("fails a service-role route with no authorization", () => {
    const r = runGuard(["public-bare/route.ts"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /naked\/route\.ts/);
  });

  it("passes a PUBLIC marker that states a reason", () => {
    const r = runGuard(["naked/route.ts", "public-bare/route.ts"]);
    assert.ok(!r.stderr.includes("public-documented/route.ts"), r.stderr);
  });

  it("rejects a bare PUBLIC marker with no reason", () => {
    const r = runGuard(["naked/route.ts"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /public-bare\/route\.ts/);
  });

  it("ignores routes that never touch the service-role client", () => {
    const r = runGuard(["naked/route.ts", "public-bare/route.ts"]);
    assert.ok(!r.stderr.includes("rls-only/route.ts"), r.stderr);
  });

  it("accepts an inline token lookup as authentication", () => {
    const r = runGuard(["naked/route.ts", "public-bare/route.ts"]);
    assert.ok(!r.stderr.includes("inline-token/route.ts"), r.stderr);
  });

  it("skips the deals/[dealId] subtree owned by the deal-route guard", () => {
    const r = runGuard(["naked/route.ts", "public-bare/route.ts"]);
    assert.ok(!r.stderr.includes("deals/[dealId]"), r.stderr);
  });

  it("passes when every failing route is allowlisted", () => {
    const r = runGuard(["naked/route.ts", "public-bare/route.ts"]);
    assert.equal(r.status, 0, r.stderr);
  });

  it("fails on a stale allowlist entry so the list can only shrink", () => {
    const r = runGuard(["naked/route.ts", "public-bare/route.ts", "authed/route.ts"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /stale allowlist entries/);
    assert.match(r.stderr, /authed\/route\.ts/);
  });
});
