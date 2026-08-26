import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("worker credentials are header-only and constant-time compared", () => {
  const src = read("src/lib/auth/hasValidWorkerSecret.ts");
  assert.match(src, /secretEquals/);
  assert.doesNotMatch(src, /searchParams\.get\(["']token["']\)/);
  assert.doesNotMatch(src, /method:\s*["']query["']/);
  assert.doesNotMatch(src, /method\?:[^\n]*query/);
});

test("artifact processing rejects caller-controlled internal markers", () => {
  const route = read("src/app/api/artifacts/process/route.ts");
  assert.match(route, /return hasValidWorkerSecret\(req\)/);
  assert.doesNotMatch(route, /x-buddy-internal/);

  const upload = read("src/app/api/deals/[dealId]/files/record/route.ts");
  assert.match(upload, /Authorization:\s*`Bearer \$\{secret\}`/);
  assert.doesNotMatch(upload, /["']x-buddy-internal["']\s*:\s*["']1["']/);
  assert.match(upload, /WORKER_SECRET\s*\?\?\s*process\.env\.CRON_SECRET/);
});

test("admin diagnostics never accept credentials in URLs", () => {
  const auth = read("src/lib/auth/hasValidAdminDebugToken.ts");
  assert.match(auth, /authorization/);
  assert.match(auth, /secretEquals/);
  assert.doesNotMatch(auth, /searchParams/);

  for (const path of [
    "src/app/api/admin/deals/[dealId]/checklist/debug/route.ts",
    "src/app/api/admin/deals/[dealId]/checklist/list/route.ts",
  ]) {
    const route = read(path);
    assert.match(route, /hasValidAdminDebugToken\(req\)/);
    assert.doesNotMatch(route, /searchParams\.get\(["']token["']\)/);
  }

  const gatekeeper = read("src/app/api/admin/gatekeeper/route.ts");
  assert.doesNotMatch(gatekeeper, /searchParams\.get\(["']token["']\)/);
  assert.match(gatekeeper, /getWorkerAuthMatch/);
});

test("diagnostic script requires injected values and uses a bearer header", () => {
  const script = read("scripts/test-checklist-reconciliation.sh");
  assert.match(script, /ADMIN_DEBUG_TOKEN:\?Set ADMIN_DEBUG_TOKEN/);
  assert.match(script, /Authorization: Bearer \$ADMIN_DEBUG_TOKEN/);
  assert.doesNotMatch(script, /\?token=\$ADMIN_DEBUG_TOKEN/);
  assert.doesNotMatch(script, /ADMIN_DEBUG_TOKEN:-[a-f0-9]{16,}/);
  assert.doesNotMatch(script, /DEAL_ID:-[0-9a-f]{8}-[0-9a-f-]{27,}/);
});
