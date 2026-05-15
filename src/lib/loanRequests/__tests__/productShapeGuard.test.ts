// SPEC-LOAN-REQUEST-FORM-V2
//
// Structural guard: product shape config is complete and correct.
// Pure source-grep — no server-only imports.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG_PATH = resolve(process.cwd(), "src/lib/loanRequests/productShapeConfig.ts");
const TYPES_PATH = resolve(process.cwd(), "src/lib/loanRequests/types.ts");

test("productShapeConfig exports getProductShape function", () => {
  const src = readFileSync(CONFIG_PATH, "utf8");
  assert.match(src, /export function getProductShape/);
});

test("LINES_OF_CREDIT shape hides term and amort", () => {
  const src = readFileSync(CONFIG_PATH, "utf8");
  // LOC_SHAPE must have showTerm: "hide" and showAmort: "hide"
  assert.match(src, /LOC_SHAPE.*showTerm:\s*"hide"/s);
  assert.match(src, /LOC_SHAPE.*showAmort:\s*"hide"/s);
});

test("LINES_OF_CREDIT shape enables evergreen toggle", () => {
  const src = readFileSync(CONFIG_PATH, "utf8");
  assert.match(src, /LOC_SHAPE.*showEvergreen:\s*true/s);
});

test("all ProductCategory values have entries in PRODUCT_SHAPE_BY_CATEGORY", () => {
  const typesSrc = readFileSync(TYPES_PATH, "utf8");
  // Extract category values from the ProductCategory union
  const categoryMatch = typesSrc.match(/export type ProductCategory\s*=([^;]+);/s);
  assert.ok(categoryMatch, "ProductCategory type must exist");
  const categories = categoryMatch![1]
    .split("|")
    .map((s) => s.trim().replace(/"/g, ""))
    .filter(Boolean);

  const configSrc = readFileSync(CONFIG_PATH, "utf8");
  for (const cat of categories) {
    assert.ok(
      configSrc.includes(`${cat}:`),
      `PRODUCT_SHAPE_BY_CATEGORY must have entry for ${cat}`,
    );
  }
});

test("SBA shape hides spread (rate is formula-driven)", () => {
  const src = readFileSync(CONFIG_PATH, "utf8");
  assert.match(src, /SBA_SHAPE.*showSpread:\s*false/s);
});
