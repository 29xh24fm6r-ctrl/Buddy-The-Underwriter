/**
 * Phase 56C — Closing Package Foundation CI Guard
 *
 * Suites:
 * 1. Docs generation gate contract
 * 2. Package generation contract
 * 3. Template system contract
 * 4. API endpoint contract
 * 5. Migration tables
 * 6. Placeholder regression
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(SRC_ROOT, relPath));
}

// ---------------------------------------------------------------------------
// 1. Docs generation gate
// ---------------------------------------------------------------------------

describe("Docs generation gate — contract", () => {
  it("getDocsGenerationGate exists", () => {
    assert.ok(fileExists("lib/closingPackage/getDocsGenerationGate.ts"));
  });

  it("checks template support", () => {
    const content = readFile("lib/closingPackage/getDocsGenerationGate.ts");
    assert.ok(content.includes("loan_doc_templates"), "must check templates");
    assert.ok(content.includes("supportedProduct"), "must return supportedProduct flag");
  });

  it("checks secure identity", () => {
    const content = readFile("lib/closingPackage/getDocsGenerationGate.ts");
    assert.ok(content.includes("deal_pii_records"), "must check PII presence");
    assert.ok(content.includes("secureIdentityComplete"), "must return identity completeness");
  });

  it("uses Builder gates as foundation", () => {
    const content = readFile("lib/closingPackage/getDocsGenerationGate.ts");
    assert.ok(content.includes("validateBuilderGates"), "must use Builder gates");
  });

  it("returns structured evidence", () => {
    const content = readFile("lib/closingPackage/getDocsGenerationGate.ts");
    assert.ok(content.includes("borrowerEntitiesComplete"), "must check borrower");
    assert.ok(content.includes("collateralSufficientForDocs"), "must check collateral");
    assert.ok(content.includes("requiredCovenantsPresent"), "must check covenants");
  });
});

// ---------------------------------------------------------------------------
// 2. Package generation
// ---------------------------------------------------------------------------

describe("Package generation — contract", () => {
  it("generateClosingPackage exists", () => {
    assert.ok(fileExists("lib/closingPackage/generateClosingPackage.ts"));
  });

  it("checks gate before generating", () => {
    const content = readFile("lib/closingPackage/generateClosingPackage.ts");
    assert.ok(content.includes("getDocsGenerationGate"), "must check gate");
    assert.ok(content.includes("docs_not_ready"), "must block when not ready");
  });

  it("creates versioned packages", () => {
    const content = readFile("lib/closingPackage/generateClosingPackage.ts");
    assert.ok(content.includes("generation_version"), "must track version");
    assert.ok(content.includes("superseded"), "must supersede prior packages");
  });

  it("creates document stubs from template", () => {
    const content = readFile("lib/closingPackage/generateClosingPackage.ts");
    assert.ok(content.includes("closing_package_documents"), "must create document records");
    assert.ok(content.includes("supported_features"), "must use template features");
  });

  it("creates closing checklist items", () => {
    const content = readFile("lib/closingPackage/generateClosingPackage.ts");
    assert.ok(content.includes("closing_checklist_items"), "must create checklist");
  });
});

// ---------------------------------------------------------------------------
// 3. Template system
// ---------------------------------------------------------------------------

describe("Template system — contract", () => {
  it("migration seeds first-wave templates", () => {
    const content = readFile("../supabase/migrations/20260326_closing_package_foundation.sql");
    assert.ok(content.includes("term_loan_standard"), "must seed term loan template");
    assert.ok(content.includes("loc_standard"), "must seed LOC template");
    assert.ok(content.includes("sba_7a_standard"), "must seed SBA template");
    assert.ok(content.includes("cre_standard"), "must seed CRE template");
  });
});

// ---------------------------------------------------------------------------
// 4. API endpoints
// ---------------------------------------------------------------------------

describe("Closing package API — contract", () => {
  it("docs-generation readiness endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/docs-generation/route.ts"));
  });

  it("closing-package GET/POST endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/closing-package/route.ts"));
  });

  it("closing-package action endpoint exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/closing-package/[packageId]/route.ts"));
  });

  it("all use Clerk auth", () => {
    for (const f of [
      "app/api/deals/[dealId]/docs-generation/route.ts",
      "app/api/deals/[dealId]/closing-package/route.ts",
      "app/api/deals/[dealId]/closing-package/[packageId]/route.ts",
    ]) {
      const content = readFile(f);
      assert.ok(content.includes("requireDealCockpitAccess"), `${f} must use cockpit access`);
    }
  });

  it("package action supports approve and supersede", () => {
    const content = readFile("app/api/deals/[dealId]/closing-package/[packageId]/route.ts");
    assert.ok(content.includes('"approve"'), "must support approve");
    assert.ok(content.includes('"supersede"'), "must support supersede");
  });
});

// ---------------------------------------------------------------------------
// 5. Migration
// ---------------------------------------------------------------------------

describe("Closing package migration — tables", () => {
  it("creates all required tables", () => {
    const content = readFile("../supabase/migrations/20260326_closing_package_foundation.sql");
    assert.ok(content.includes("closing_packages"), "must create packages table");
    assert.ok(content.includes("closing_package_documents"), "must create documents table");
    assert.ok(content.includes("closing_checklist_items"), "must create checklist table");
    assert.ok(content.includes("loan_doc_templates"), "must create templates table");
  });

  it("packages support full lifecycle", () => {
    const content = readFile("../supabase/migrations/20260326_closing_package_foundation.sql");
    for (const s of ["draft", "generated", "approved_for_send", "superseded", "failed"]) {
      assert.ok(content.includes(s), `must support status "${s}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Placeholder regression
// ---------------------------------------------------------------------------

describe("Closing package — no placeholders", () => {
  it("modules have no placeholder markers", () => {
    const files = [
      "lib/closingPackage/getDocsGenerationGate.ts",
      "lib/closingPackage/generateClosingPackage.ts",
    ];
    for (const f of files) {
      const content = readFile(f);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bTODO\b|placeholder|coming soon/i.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          assert.fail(`Placeholder in ${f}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  });
});
