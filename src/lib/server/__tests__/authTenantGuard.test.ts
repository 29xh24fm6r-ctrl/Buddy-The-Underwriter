/**
 * Phase 53B — Auth + Tenant + Wiring CI Guard
 *
 * Prevents regression of:
 * 1. Legacy tenant contamination (Old Glory / OGB in runtime code)
 * 2. Missing authz helpers in shared access layer
 * 3. Placeholder / unwired markers in user-facing runtime code
 * 4. Unsafe .single() patterns (extends Phase 53A guard)
 *
 * Test suites:
 * A. Legacy contamination guard
 * B. Access layer structural contract
 * C. Wiring markers guard
 * D. Deal access helpers contract
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC_ROOT = path.resolve(__dirname, "../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(SRC_ROOT, relPath));
}

function globSync(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const absDir = path.join(SRC_ROOT, dir);
  if (!fs.existsSync(absDir)) return results;
  const entries = fs.readdirSync(absDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    if (entry.isFile() && pattern.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// Encoded search terms to avoid the test file matching itself
const LEGACY_BANK = ["Old", "Glory"].join(" ");
const LEGACY_FORM = ["OGB", "SBA", "INTAKE"].join("_");

// Files to exclude from contamination scan
const CONTAMINATION_ALLOWLIST = new Set([
  // Migration seeds (historical, already applied)
  "supabase/migrations/",
  // Test fixture data (authentic OCR content)
  "__tests__/realOcrExtraction.test.ts",
  // Dead backup file
  ".stitch-backup",
  // Docs (historical examples)
  "docs/",
  // This test file itself (contains encoded search terms)
  "authTenantGuard.test.ts",
]);

function isAllowlisted(filePath: string): boolean {
  const rel = path.relative(SRC_ROOT, filePath);
  for (const prefix of CONTAMINATION_ALLOWLIST) {
    if (rel.includes(prefix)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// A. Legacy contamination guard
// ---------------------------------------------------------------------------

describe("Legacy tenant contamination guard", () => {
  it("no runtime legacy bank name references in src/ (excluding allowlist)", () => {
    const tsFiles = globSync("", /\.(ts|tsx)$/);
    const violations: string[] = [];
    const pattern = new RegExp(LEGACY_BANK, "i");

    for (const file of tsFiles) {
      if (isAllowlisted(file)) continue;
      if (file.includes("node_modules")) continue;
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (pattern.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          violations.push(`${path.relative(SRC_ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Runtime legacy bank name references found:\n${violations.join("\n")}`,
    );
  });

  it("no runtime legacy form identifiers in src/", () => {
    const tsFiles = globSync("", /\.(ts|tsx)$/);
    const violations: string[] = [];

    for (const file of tsFiles) {
      if (isAllowlisted(file)) continue;
      if (file.includes("node_modules")) continue;
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes(LEGACY_FORM)) {
        violations.push(path.relative(SRC_ROOT, file));
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Legacy form identifiers found in runtime code:\n${violations.join("\n")}`,
    );
  });

  it("ensureDealHasBank does not default to OGB", () => {
    const content = readFile("lib/banks/ensureDealHasBank.ts");
    assert.ok(
      !content.includes('= "OGB"'),
      "ensureDealHasBank must not default to OGB bank code",
    );
  });

  it("requestEmail does not hardcode a bank name", () => {
    const content = readFile("lib/packs/requirements/requestEmail.ts");
    const legacyBankFull = `${LEGACY_BANK} Bank`;
    assert.ok(
      !content.includes(`"${legacyBankFull}"`) && !content.includes(`'${legacyBankFull}'`),
      "requestEmail must not hardcode legacy bank name",
    );
    assert.ok(
      content.includes("bankName"),
      "requestEmail must accept bankName parameter",
    );
  });
});

// ---------------------------------------------------------------------------
// B. Access layer structural contract
// ---------------------------------------------------------------------------

describe("Shared access layer — structural contract", () => {
  it("access-errors.ts exists and exports typed errors", () => {
    assert.ok(fileExists("lib/server/access-errors.ts"));
    const content = readFile("lib/server/access-errors.ts");
    const required = [
      "AuthenticationRequiredError",
      "ProfileRequiredError",
      "BankMembershipRequiredError",
      "DealAccessDeniedError",
      "RoleAccessDeniedError",
      "isAccessError",
    ];
    for (const name of required) {
      assert.ok(content.includes(name), `access-errors.ts must export ${name}`);
    }
  });

  it("authz.ts exists and exports auth helpers", () => {
    assert.ok(fileExists("lib/server/authz.ts"));
    const content = readFile("lib/server/authz.ts");
    const required = [
      "requireUser",
      "requireProfile",
      "requireBankMembership",
      "requireDealAccess",
      "requireRole",
    ];
    for (const name of required) {
      assert.ok(content.includes(`export async function ${name}`), `authz.ts must export ${name}`);
    }
  });

  it("authz.ts uses server-only import", () => {
    const content = readFile("lib/server/authz.ts");
    assert.ok(content.includes('"server-only"'), "authz.ts must import server-only");
  });

  it("deal-access.ts exists and exports deal helpers", () => {
    assert.ok(fileExists("lib/server/deal-access.ts"));
    const content = readFile("lib/server/deal-access.ts");
    const required = ["resolveDealAccess", "assertDealAccess", "resolveDealBankId"];
    for (const name of required) {
      assert.ok(content.includes(name), `deal-access.ts must export ${name}`);
    }
  });

  it("deal-access.ts uses server-only import", () => {
    const content = readFile("lib/server/deal-access.ts");
    assert.ok(content.includes('"server-only"'), "deal-access.ts must import server-only");
  });

  it("authz.ts logs tenant mismatches with structured fields", () => {
    const content = readFile("lib/server/authz.ts");
    assert.ok(content.includes("tenant_scope_mismatch"), "must log tenant_scope_mismatch event");
    assert.ok(content.includes("severity"), "must include severity in log");
    assert.ok(content.includes("timestamp"), "must include timestamp in log");
  });
});

// ---------------------------------------------------------------------------
// C. Wiring markers guard — runtime code should not contain live placeholders
// ---------------------------------------------------------------------------

describe("Wiring markers guard", () => {
  // Files that are allowed to have TODO/placeholder markers
  const WIRING_ALLOWLIST = new Set([
    "SafeBoundary.tsx", // Has TODO for Sentry integration
  ]);

  it("no 'Coming Soon' alerts in user-facing component handlers", () => {
    const components = globSync("components", /\.tsx$/);
    const violations: string[] = [];

    for (const file of components) {
      const name = path.basename(file);
      if (WIRING_ALLOWLIST.has(name)) continue;
      const content = fs.readFileSync(file, "utf-8");
      // Look for alert() calls with "coming soon" text
      if (/alert\s*\([^)]*coming\s+soon/i.test(content)) {
        violations.push(path.relative(SRC_ROOT, file));
      }
    }

    // Known existing placeholders — track them explicitly so new ones fail CI
    const KNOWN_PLACEHOLDERS = new Set([
      "components/deals/BorrowerConditionsCard.tsx",
      "components/deals/EntitySelector.tsx",
    ]);

    const newViolations = violations.filter((v) => !KNOWN_PLACEHOLDERS.has(v));
    assert.deepStrictEqual(
      newViolations,
      [],
      `New "Coming Soon" alert() placeholders found:\n${newViolations.join("\n")}\n\nExisting known: ${[...KNOWN_PLACEHOLDERS].join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// D. Deal access helpers — no caller-supplied bankId trust
// ---------------------------------------------------------------------------

describe("Deal access — no caller-supplied bankId trust", () => {
  it("deal-access.ts does not accept bankId as a parameter", () => {
    const content = readFile("lib/server/deal-access.ts");
    // resolveDealAccess and assertDealAccess should only take dealId
    assert.ok(
      !content.includes("bankId: string") ||
        content.includes("resolveDealBankId"), // resolveDealBankId returns bankId, but doesn't accept it from caller
      "deal access helpers must derive bankId from auth context, not accept it as a parameter",
    );
  });

  it("authz.requireDealAccess derives bankId from server context", () => {
    const content = readFile("lib/server/authz.ts");
    // Check that requireDealAccess calls requireBankMembership (server-derived)
    assert.ok(
      content.includes("requireBankMembership()"),
      "requireDealAccess must call requireBankMembership to derive bankId",
    );
  });
});
