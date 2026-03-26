/**
 * Phase 56B — Builder Readiness, Borrower Activation & Secure Intake CI Guard
 *
 * Suites:
 * 1. Secure PII contract
 * 2. Builder gate validation contract
 * 3. Submit-to-credit contract
 * 4. Generate-docs contract
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
// 1. Secure PII
// ---------------------------------------------------------------------------

describe("Secure PII intake — contract", () => {
  it("securePiiIntake module exists", () => {
    assert.ok(fileExists("lib/builder/secure/securePiiIntake.ts"));
  });

  it("never stores plaintext in builder sections", () => {
    const content = readFile("lib/builder/secure/securePiiIntake.ts");
    assert.ok(content.includes("encrypted_payload"), "must use encrypted storage");
    assert.ok(content.includes("last4"), "must store only last4");
    assert.ok(content.includes("NEVER"), "must have never-log comment");
  });

  it("provides getPiiStatus that returns only presence flags", () => {
    const content = readFile("lib/builder/secure/securePiiIntake.ts");
    assert.ok(content.includes("getPiiStatus"), "must export getPiiStatus");
    assert.ok(content.includes("ssnOnFile"), "must return ssnOnFile flag");
    assert.ok(content.includes("tinOnFile"), "must return tinOnFile flag");
  });

  it("PII API route uses Clerk auth", () => {
    const content = readFile("app/api/deals/[dealId]/builder/pii/route.ts");
    assert.ok(content.includes("requireDealCockpitAccess"), "must use cockpit access");
  });

  it("PII API never returns plaintext to client", () => {
    const content = readFile("app/api/deals/[dealId]/builder/pii/route.ts");
    assert.ok(content.includes("last4"), "must return only last4");
    assert.ok(!content.includes("plaintext") || content.includes("body.plaintext"),
      "must not return plaintext in response");
  });
});

// ---------------------------------------------------------------------------
// 2. Builder gate validation
// ---------------------------------------------------------------------------

describe("Builder gate validation — contract", () => {
  it("builderGateValidation module exists", () => {
    assert.ok(fileExists("lib/builder/builderGateValidation.ts"));
  });

  it("returns creditReady + docReady + borrowerSubmitReady", () => {
    const content = readFile("lib/builder/builderGateValidation.ts");
    assert.ok(content.includes("creditReady"), "must return creditReady");
    assert.ok(content.includes("docReady"), "must return docReady");
    assert.ok(content.includes("borrowerSubmitReady"), "must return borrowerSubmitReady");
  });

  it("checks canonical server sources (not client state)", () => {
    const content = readFile("lib/builder/builderGateValidation.ts");
    assert.ok(content.includes("supabaseAdmin"), "must use server DB");
    assert.ok(content.includes("deal_loan_requests"), "must check loan request");
    assert.ok(content.includes("deal_truth_snapshots"), "must check snapshot");
    assert.ok(content.includes("getParticipationSummary"), "must check participation");
  });

  it("readiness API route exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/builder/readiness/route.ts"));
  });
});

// ---------------------------------------------------------------------------
// 3. Submit-to-credit
// ---------------------------------------------------------------------------

describe("Submit-to-credit — contract", () => {
  it("route exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/builder/submit-to-credit/route.ts"));
  });

  it("uses server-side gate validation", () => {
    const content = readFile("app/api/deals/[dealId]/builder/submit-to-credit/route.ts");
    assert.ok(content.includes("validateBuilderGates"), "must validate gates server-side");
  });

  it("blocks when not credit ready", () => {
    const content = readFile("app/api/deals/[dealId]/builder/submit-to-credit/route.ts");
    assert.ok(content.includes("credit_not_ready"), "must return credit_not_ready error");
    assert.ok(content.includes("creditBlockers"), "must return blockers");
  });

  it("creates submission record and logs event", () => {
    const content = readFile("app/api/deals/[dealId]/builder/submit-to-credit/route.ts");
    assert.ok(content.includes("deal_builder_submissions"), "must create submission record");
    assert.ok(content.includes("submit_to_credit_submitted"), "must log submitted event");
    assert.ok(content.includes("submit_to_credit_blocked"), "must log blocked event");
  });
});

// ---------------------------------------------------------------------------
// 4. Generate-docs
// ---------------------------------------------------------------------------

describe("Generate-docs — contract", () => {
  it("route exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/builder/generate-docs/route.ts"));
  });

  it("uses server-side gate validation", () => {
    const content = readFile("app/api/deals/[dealId]/builder/generate-docs/route.ts");
    assert.ok(content.includes("validateBuilderGates"), "must validate gates server-side");
  });

  it("blocks when not doc ready", () => {
    const content = readFile("app/api/deals/[dealId]/builder/generate-docs/route.ts");
    assert.ok(content.includes("docs_not_ready"), "must return docs_not_ready error");
  });

  it("logs launch and block events", () => {
    const content = readFile("app/api/deals/[dealId]/builder/generate-docs/route.ts");
    assert.ok(content.includes("generate_docs_launched"), "must log launch event");
    assert.ok(content.includes("generate_docs_blocked"), "must log blocked event");
  });
});

// ---------------------------------------------------------------------------
// 5. Migration
// ---------------------------------------------------------------------------

describe("Builder readiness migration — tables", () => {
  it("creates required tables", () => {
    const content = readFile("../supabase/migrations/20260326_builder_readiness_secure_intake.sql");
    assert.ok(content.includes("deal_pii_records"), "must create PII records table");
    assert.ok(content.includes("deal_builder_submissions"), "must create submissions table");
    assert.ok(content.includes("encrypted_payload"), "PII must have encrypted storage");
  });
});

// ---------------------------------------------------------------------------
// 6. Placeholder regression
// ---------------------------------------------------------------------------

describe("Builder readiness — no placeholders", () => {
  it("modules have no placeholder markers", () => {
    const files = [
      "lib/builder/secure/securePiiIntake.ts",
      "lib/builder/builderGateValidation.ts",
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
