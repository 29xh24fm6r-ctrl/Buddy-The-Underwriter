/**
 * Phase 56D — Lifecycle Auth Unification CI Guard
 *
 * Suites:
 * 1. Lifecycle action route uses unified cockpit auth
 * 2. Lifecycle action route does not use stale auth pattern
 * 3. Error detail contract
 * 4. Structured logging present
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// 1. Lifecycle action uses unified cockpit auth
// ---------------------------------------------------------------------------

describe("Lifecycle action route — unified auth", () => {
  it("uses requireDealCockpitAccess", () => {
    const content = readFile("app/api/deals/[dealId]/lifecycle/action/route.ts");
    assert.ok(
      content.includes("requireDealCockpitAccess"),
      "lifecycle action must use requireDealCockpitAccess",
    );
  });

  it("imports COCKPIT_ROLES", () => {
    const content = readFile("app/api/deals/[dealId]/lifecycle/action/route.ts");
    assert.ok(
      content.includes("COCKPIT_ROLES"),
      "lifecycle action must use COCKPIT_ROLES constant",
    );
  });

  it("passes dealId to the auth guard", () => {
    const content = readFile("app/api/deals/[dealId]/lifecycle/action/route.ts");
    assert.ok(
      content.includes("requireDealCockpitAccess(dealId"),
      "must pass dealId to cockpit auth",
    );
  });

  it("uses auth.bankId for downstream operations", () => {
    const content = readFile("app/api/deals/[dealId]/lifecycle/action/route.ts");
    assert.ok(
      content.includes("auth.bankId"),
      "must use bankId from unified auth result",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. No stale auth pattern
// ---------------------------------------------------------------------------

describe("Lifecycle action route — no stale auth", () => {
  it("does not import requireRoleApi", () => {
    const content = readFile("app/api/deals/[dealId]/lifecycle/action/route.ts");
    // Check for actual import statement, not just comment mentions
    assert.ok(
      !content.includes('import { requireRoleApi') && !content.includes('from "@/lib/auth/requireRole"'),
      "lifecycle action must NOT import requireRoleApi (Clerk-only, causes false role_missing)",
    );
  });

  it("does not import ensureDealBankAccess directly", () => {
    const content = readFile("app/api/deals/[dealId]/lifecycle/action/route.ts");
    assert.ok(
      !content.includes("ensureDealBankAccess"),
      "lifecycle action must NOT use separate ensureDealBankAccess (unified guard handles this)",
    );
  });

  it("does not catch AuthorizationError (handled by unified guard)", () => {
    const content = readFile("app/api/deals/[dealId]/lifecycle/action/route.ts");
    assert.ok(
      !content.includes("AuthorizationError"),
      "lifecycle action must NOT catch AuthorizationError (unified guard returns result object)",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Error detail contract
// ---------------------------------------------------------------------------

describe("Lifecycle action route — error detail", () => {
  it("returns detail field in auth failure response", () => {
    const content = readFile("app/api/deals/[dealId]/lifecycle/action/route.ts");
    assert.ok(
      content.includes("detail"),
      "must return detail field for richer error observability",
    );
  });

  it("returns auth.status for HTTP status code", () => {
    const content = readFile("app/api/deals/[dealId]/lifecycle/action/route.ts");
    assert.ok(
      content.includes("auth.status"),
      "must use auth.status for HTTP response code",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Structured logging
// ---------------------------------------------------------------------------

describe("Lifecycle action route — structured logging", () => {
  it("logs auth result with dealId and role", () => {
    const content = readFile("app/api/deals/[dealId]/lifecycle/action/route.ts");
    assert.ok(
      content.includes("[lifecycle/action] cockpit auth result"),
      "must log structured auth result for debugging",
    );
  });
});
