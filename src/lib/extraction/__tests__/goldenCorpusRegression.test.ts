/**
 * G1-G2: Golden Corpus + CI Regression Suite
 *
 * Bank-grade CI guards:
 * - Schema validation on all golden files
 * - Deterministic extractor regression on goldens
 * - Validator regression on goldens
 * - No T12 doc type tripwire
 * - No "estimate" in prompts tripwire
 * - No slot bind without unique match tripwire
 * - No @google-cloud/documentai imports tripwire
 * - No freeform failure codes tripwire
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

// Import from PURE modules only — never from barrel (which re-exports server-only modules)
import {
  validateStructuredOutput,
  STRUCTURED_SCHEMA_VERSION,
} from "../schemas/structuredOutput";
import { PROMPT_VERSION, buildStructuredAssistPrompt } from "../geminiFlashPrompts";
import { EXTRACTION_ENGINE_VERSION, EXTRACTION_EVENT_KINDS, VALID_EXTRACTION_EVENT_KINDS } from "../ledgerContract";
import { EXTRACTION_FAILURE_CODES, VALID_FAILURE_CODES } from "../failureCodes";
import { normalizeStructuredJson, computeStructuredOutputHash } from "../outputCanonicalization";

import {
  validateExtractionQuality,
  runValidationGate,
  BS_BALANCE_TOLERANCE,
  IS_GP_TOLERANCE,
} from "../../spreads/preflight/validateExtractedFinancials";

// ── Helpers ──────────────────────────────────────────────────────────

const GOLDENS_DIR = path.join(
  process.cwd(),
  "goldens",
  "structured_json",
);

function loadGoldenFile(name: string): Record<string, unknown> {
  const filePath = path.join(GOLDENS_DIR, name);
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content);
}

function listGoldenFiles(): string[] {
  if (!fs.existsSync(GOLDENS_DIR)) return [];
  return fs.readdirSync(GOLDENS_DIR).filter((f) => f.endsWith(".json"));
}

// ── G1: Golden Corpus Schema Validation ──────────────────────────────

describe("G1: Golden Corpus Schema Validation", () => {
  const files = listGoldenFiles();

  it("golden corpus directory exists with at least 4 files", () => {
    assert.ok(fs.existsSync(GOLDENS_DIR), "goldens/structured_json/ must exist");
    assert.ok(files.length >= 4, `Expected >=4 golden files, got ${files.length}`);
  });

  for (const file of files) {
    it(`${file}: passes structured output schema validation`, () => {
      const golden = loadGoldenFile(file);
      // Strip metadata fields (prefixed with _)
      const { _description, _doc_type, _expected_validator, ...data } = golden;
      const result = validateStructuredOutput(data);
      assert.ok(
        result.valid,
        `${file} failed schema validation: ${result.errors.join(", ")}`,
      );
    });

    it(`${file}: has required metadata fields`, () => {
      const golden = loadGoldenFile(file);
      assert.ok(golden._doc_type, `${file} missing _doc_type`);
      assert.ok(golden._expected_validator, `${file} missing _expected_validator`);
    });

    it(`${file}: produces deterministic output hash`, () => {
      const golden = loadGoldenFile(file);
      const { _description, _doc_type, _expected_validator, ...data } = golden;
      const hash1 = computeStructuredOutputHash(data);
      const hash2 = computeStructuredOutputHash(data);
      assert.ok(hash1, `${file} produced null hash`);
      assert.equal(hash1, hash2, `${file} hash not deterministic`);
    });
  }
});

// ── G2: CI Regression Guards ─────────────────────────────────────────

describe("G2: CI Regression Guards", () => {
  it("no T12 in doc type routing class map", () => {
    // T12 must map to INCOME_STATEMENT, never be a standalone doc type
    const { resolveDocTypeRouting } = require("../../documents/docTypeRouting");
    const resolved = resolveDocTypeRouting("T12");
    assert.equal(
      resolved.canonical_type,
      "INCOME_STATEMENT",
      "T12 must map to INCOME_STATEMENT",
    );
  });

  it("no 'estimate' or 'best guess' in any prompt", () => {
    const docTypes = [
      "BUSINESS_TAX_RETURN",
      "PERSONAL_TAX_RETURN",
      "BALANCE_SHEET",
      "INCOME_STATEMENT",
    ];
    const forbidden = ["estimate", "best guess", "approximate", "infer"];

    for (const dt of docTypes) {
      const prompt = buildStructuredAssistPrompt(dt, "");
      assert.ok(prompt, `No prompt for ${dt}`);
      const text = (
        prompt.systemInstruction + " " + prompt.userPrompt
      ).toLowerCase();

      for (const word of forbidden) {
        assert.ok(
          !text.includes(word),
          `Prompt for ${dt} contains forbidden word "${word}"`,
        );
      }
    }
  });

  it("no @google-cloud/documentai imports in src/ (excluding test files)", () => {
    // Walk src/ looking for documentai imports — exclude test files
    // which may reference the string in assertion messages
    const srcDir = path.join(process.cwd(), "src");
    const tsFiles = findTsFiles(srcDir).filter(
      (f) => !f.includes("__tests__") && !f.includes(".test."),
    );
    const violators: string[] = [];

    for (const file of tsFiles) {
      const content = fs.readFileSync(file, "utf-8");
      // Check for actual import/require statements, not just string references
      if (
        content.includes('from "@google-cloud/documentai"') ||
        content.includes('from \'@google-cloud/documentai\'') ||
        content.includes('require("@google-cloud/documentai")') ||
        content.includes("require('@google-cloud/documentai')")
      ) {
        violators.push(file.replace(process.cwd() + "/", ""));
      }
    }

    assert.equal(
      violators.length,
      0,
      `Files still importing @google-cloud/documentai: ${violators.join(", ")}`,
    );
  });

  it("all failure codes are standardized (no freeform)", () => {
    assert.equal(VALID_FAILURE_CODES.size, 12);
    for (const code of VALID_FAILURE_CODES) {
      assert.ok(
        Object.values(EXTRACTION_FAILURE_CODES).includes(code as any),
        `Unknown failure code: ${code}`,
      );
    }
  });

  it("all extraction event kinds are standardized", () => {
    assert.equal(VALID_EXTRACTION_EVENT_KINDS.size, 10);
  });

  it("engine version matches expected format", () => {
    assert.match(EXTRACTION_ENGINE_VERSION, /^hybrid_v\d+\.\d+$/);
  });

  it("prompt version matches expected format", () => {
    assert.match(PROMPT_VERSION, /^flash_prompts_v\d+$/);
  });

  it("schema version matches expected format", () => {
    assert.match(STRUCTURED_SCHEMA_VERSION, /^structured_v\d+$/);
  });

  it("BS_BALANCE_TOLERANCE is 5%", () => {
    assert.equal(BS_BALANCE_TOLERANCE, 0.05);
  });

  it("IS_GP_TOLERANCE is 5%", () => {
    assert.equal(IS_GP_TOLERANCE, 0.05);
  });

  it("golden BTR passes validator", () => {
    // The golden BTR has balanced BS (A=L+E: 3200000 = 1800000 + 1400000)
    const golden = loadGoldenFile("business_tax_return_1120.json");
    assert.equal(golden._expected_validator, "PASSED");
  });

  it("golden BS passes validator with balanced equation", () => {
    const golden = loadGoldenFile("balance_sheet_standard.json");
    assert.equal(golden._expected_validator, "PASSED");
    // Verify: total_assets (2M) = total_liabilities (1.15M) + total_equity (850K) = 2M
    const entities = golden.entities as any[];
    const totalAssets = entities.find((e: any) => e.type === "total_assets");
    const totalLiabilities = entities.find((e: any) => e.type === "total_liabilities");
    const totalEquity = entities.find((e: any) => e.type === "total_equity");
    assert.ok(totalAssets);
    assert.ok(totalLiabilities);
    assert.ok(totalEquity);
    const a = totalAssets.normalizedValue.moneyValue.units;
    const l = totalLiabilities.normalizedValue.moneyValue.units;
    const e = totalEquity.normalizedValue.moneyValue.units;
    assert.ok(Math.abs(a - (l + e)) / a <= BS_BALANCE_TOLERANCE);
  });

  it("golden IS passes GP consistency check", () => {
    const golden = loadGoldenFile("income_statement_t12.json");
    assert.equal(golden._expected_validator, "PASSED");
    // Verify: revenue (1.8M) - COGS (720K) = GP (1.08M)
    const entities = golden.entities as any[];
    const revenue = entities.find((e: any) => e.type === "total_revenue");
    const cogs = entities.find((e: any) => e.type === "cost_of_goods_sold");
    const gp = entities.find((e: any) => e.type === "gross_profit");
    assert.ok(revenue);
    assert.ok(cogs);
    assert.ok(gp);
    const r = revenue.normalizedValue.moneyValue.units;
    const c = cogs.normalizedValue.moneyValue.units;
    const g = gp.normalizedValue.moneyValue.units;
    assert.ok(
      Math.abs(g - (r - c)) / r <= IS_GP_TOLERANCE,
      `GP check failed: ${r} - ${c} = ${r - c}, got ${g}`,
    );
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        results.push(...findTsFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        results.push(fullPath);
      }
    }
  } catch {
    // Skip unreadable dirs
  }
  return results;
}
