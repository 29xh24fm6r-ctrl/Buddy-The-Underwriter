import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * requireRoleApi + AuthorizationError — regression tests
 *
 * These are source-code invariant tests. They verify structural guarantees
 * without needing Clerk mocks or database connections:
 *
 * 1. requireRoleApi exists and is exported
 * 2. requireRoleApi never calls redirect() (the root cause of production 500s)
 * 3. AuthorizationError class is exported with the expected codes
 * 4. requireRole (page variant) still uses redirect()
 */

const SOURCE_PATH = resolve(__dirname, "../requireRole.ts");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("requireRoleApi — structural invariants", () => {
  it("exports requireRoleApi function", () => {
    assert.ok(
      source.includes("export async function requireRoleApi("),
      "requireRoleApi must be exported",
    );
  });

  it("exports AuthorizationError class", () => {
    assert.ok(
      source.includes("export class AuthorizationError extends Error"),
      "AuthorizationError must be exported",
    );
  });

  it("AuthorizationError has expected error codes", () => {
    assert.ok(source.includes('"not_authenticated"'), "must have not_authenticated code");
    assert.ok(source.includes('"role_missing"'), "must have role_missing code");
    assert.ok(source.includes('"role_not_allowed"'), "must have role_not_allowed code");
  });

  it("requireRoleApi never calls redirect()", () => {
    // Extract the requireRoleApi function body
    const fnStart = source.indexOf("export async function requireRoleApi(");
    assert.ok(fnStart !== -1, "requireRoleApi must exist");

    // Find the function body (from opening brace to matching closing brace)
    const bodyStart = source.indexOf("{", fnStart);
    let depth = 0;
    let bodyEnd = bodyStart;
    for (let i = bodyStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
    const fnBody = source.slice(bodyStart, bodyEnd + 1);

    // Must NOT contain redirect() call
    assert.ok(
      !fnBody.includes("redirect("),
      "requireRoleApi must never call redirect() — this was the root cause of production 500s",
    );
  });

  it("requireRole (page variant) still uses redirect()", () => {
    // The page variant must continue to use redirect for server component/page auth
    const fnStart = source.indexOf("export async function requireRole(");
    assert.ok(fnStart !== -1, "requireRole must still exist for pages/layouts");

    const bodyStart = source.indexOf("{", fnStart);
    let depth = 0;
    let bodyEnd = bodyStart;
    for (let i = bodyStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
    const fnBody = source.slice(bodyStart, bodyEnd + 1);

    assert.ok(
      fnBody.includes("redirect("),
      "requireRole (page variant) must use redirect() for proper Next.js page/layout auth",
    );
  });

  it("no API route imports requireRole (non-Api variant)", () => {
    // Verify all API routes use requireRoleApi, not requireRole
    const { execSync } = require("node:child_process");
    const result = execSync(
      `grep -r 'import { requireRole }' src/app/api/ 2>/dev/null || true`,
      { cwd: resolve(__dirname, "../../../.."), encoding: "utf-8" },
    );
    assert.strictEqual(
      result.trim(),
      "",
      `Found API routes still importing requireRole (should be requireRoleApi):\n${result}`,
    );
  });
});
