/**
 * SPEC-GEMINI-FLASH-LITE-MIGRATION-1 §3.1 — model registry guards.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isGemini3Model, GEMINI_FLASH, GEMINI_PRO } from "@/lib/ai/models";

const FILE = resolve(process.cwd(), "src/lib/ai/models.ts");
const SRC = readFileSync(FILE, "utf8");

test("[models-1] GEMINI_FLASH is gemini-3.1-flash-lite", () => {
  assert.equal(GEMINI_FLASH, "gemini-3.1-flash-lite");
});

test("[models-2] GEMINI_PRO unchanged (3.1-pro-preview)", () => {
  assert.equal(GEMINI_PRO, "gemini-3.1-pro-preview");
});

test("[models-3] isGemini3Model matches gemini-3.1-flash-lite", () => {
  assert.equal(isGemini3Model("gemini-3.1-flash-lite"), true);
});

test("[models-4] isGemini3Model matches gemini-3.1-pro-preview", () => {
  assert.equal(isGemini3Model("gemini-3.1-pro-preview"), true);
});

test("[models-5] isGemini3Model rejects gemini-2.5-flash", () => {
  assert.equal(isGemini3Model("gemini-2.5-flash"), false);
});

test("[models-6] no stale references to gemini-3-flash-preview", () => {
  assert.doesNotMatch(
    SRC,
    /["']gemini-3-flash-preview["']/,
    "models.ts still references retired gemini-3-flash-preview as a value",
  );
});
