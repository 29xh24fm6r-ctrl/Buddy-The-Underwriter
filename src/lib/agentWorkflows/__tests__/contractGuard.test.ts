/**
 * Phase 74 — Output Contract Guard Tests
 *
 * Validates that every workflow has a Zod output contract
 * and that contracts remain pure (no server-only, no DB).
 *
 * Run with: node --import tsx --test src/lib/agentWorkflows/__tests__/contractGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");
const CONTRACTS_DIR = join(ROOT, "src/lib/agentWorkflows/contracts");

// ============================================================================
// Guard 1: Contracts directory exists with minimum files
// ============================================================================

describe("Guard 1: Contracts directory", () => {
  it("contracts directory exists", () => {
    assert.ok(existsSync(CONTRACTS_DIR), "contracts/ directory must exist");
  });

  it("has at least 4 contract files", () => {
    const files = readdirSync(CONTRACTS_DIR).filter((f) =>
      f.endsWith(".contract.ts"),
    );
    assert.ok(
      files.length >= 4,
      `expected >= 4 contract files, found ${files.length}`,
    );
  });
});

// ============================================================================
// Guard 2: Every contract file exports a validate function
// ============================================================================

describe("Guard 2: Contract validate exports", () => {
  const files = readdirSync(CONTRACTS_DIR).filter((f) =>
    f.endsWith(".contract.ts"),
  );

  for (const file of files) {
    it(`${file} exports a validate function`, () => {
      const source = readFileSync(join(CONTRACTS_DIR, file), "utf-8");
      assert.ok(
        source.includes("export function validate"),
        `${file} must export a validate function`,
      );
    });
  }
});

// ============================================================================
// Guard 3: Every contract uses Zod
// ============================================================================

describe("Guard 3: Zod usage", () => {
  const files = readdirSync(CONTRACTS_DIR).filter((f) =>
    f.endsWith(".contract.ts"),
  );

  for (const file of files) {
    it(`${file} imports from zod`, () => {
      const source = readFileSync(join(CONTRACTS_DIR, file), "utf-8");
      assert.ok(
        source.includes('from "zod"'),
        `${file} must import from zod`,
      );
    });
  }
});

// ============================================================================
// Guard 4: No contract imports execution code or server-only
// ============================================================================

describe("Guard 4: Contracts are pure", () => {
  const files = readdirSync(CONTRACTS_DIR).filter((f) =>
    f.endsWith(".contract.ts"),
  );

  for (const file of files) {
    it(`${file} does not import supabase`, () => {
      const source = readFileSync(join(CONTRACTS_DIR, file), "utf-8");
      assert.ok(
        !source.match(/import.*from.*supabase/i),
        `${file} must not import supabase`,
      );
    });

    it(`${file} does not import server-only`, () => {
      const source = readFileSync(join(CONTRACTS_DIR, file), "utf-8");
      assert.ok(
        !source.match(/import\s+["']server-only["']/),
        `${file} must not import server-only`,
      );
    });

    it(`${file} does not import execution code`, () => {
      const source = readFileSync(join(CONTRACTS_DIR, file), "utf-8");
      assert.ok(
        !source.match(/import.*from.*(runMission|executeCanonical|orchestrator)/),
        `${file} must not import execution code`,
      );
    });
  }
});

// ============================================================================
// Guard 5: Contracts export tiered severity
// ============================================================================

describe("Guard 5: Tiered validation severity", () => {
  const files = readdirSync(CONTRACTS_DIR).filter((f) =>
    f.endsWith(".contract.ts"),
  );

  for (const file of files) {
    it(`${file} returns severity "block" or "warn"`, () => {
      const source = readFileSync(join(CONTRACTS_DIR, file), "utf-8");
      assert.ok(
        source.includes('"block"') && source.includes('"warn"'),
        `${file} must support both "block" and "warn" severity`,
      );
    });
  }
});

// ============================================================================
// Guard 6: Barrel export exists
// ============================================================================

describe("Guard 6: Barrel export", () => {
  it("contracts/index.ts exists", () => {
    assert.ok(
      existsSync(join(CONTRACTS_DIR, "index.ts")),
      "contracts/index.ts must exist",
    );
  });

  it("barrel exports all 4 validate functions", () => {
    const source = readFileSync(join(CONTRACTS_DIR, "index.ts"), "utf-8");
    const required = [
      "validateResearchNarrative",
      "validateBorrowerDraft",
      "validateExtractionOutput",
      "validateMemoNarrative",
    ];
    for (const fn of required) {
      assert.ok(
        source.includes(fn),
        `barrel must export ${fn}`,
      );
    }
  });
});

// ============================================================================
// Guard 7: Runtime contract validation works
// ============================================================================

describe("Guard 7: Runtime validation", () => {
  it("validateBorrowerDraft blocks on missing required fields", async () => {
    const { validateBorrowerDraft } = await import(
      "../contracts/borrowerDraft.contract"
    );
    const result = validateBorrowerDraft({});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.severity, "block");
  });

  it("validateBorrowerDraft passes on valid input", async () => {
    const { validateBorrowerDraft } = await import(
      "../contracts/borrowerDraft.contract"
    );
    const result = validateBorrowerDraft({
      draft_subject: "Missing Tax Returns",
      draft_message:
        "We need your 2024 federal business tax returns to proceed with underwriting.",
      missing_document_type: "business_tax_return",
      evidence: [{ condition: "CTC-001" }],
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.severity, "warn");
  });

  it("validateResearchNarrative blocks on empty sections", async () => {
    const { validateResearchNarrative } = await import(
      "../contracts/researchNarrative.contract"
    );
    const result = validateResearchNarrative({ sections: [], version: 1 });
    assert.strictEqual(result.ok, false);
  });

  it("validateMemoNarrative blocks on missing fields", async () => {
    const { validateMemoNarrative } = await import(
      "../contracts/memoSection.contract"
    );
    const result = validateMemoNarrative({});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.severity, "block");
  });
});
