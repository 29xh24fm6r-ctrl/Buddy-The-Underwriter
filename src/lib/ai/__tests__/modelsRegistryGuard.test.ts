/**
 * SPEC-GEMINI-FLASH-LITE-MIGRATION-1 §3.1 — model registry guards.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isGemini3Model,
  GEMINI_FLASH,
  GEMINI_FLASH_PRECISION,
  GEMINI_PRO,
  MODEL_EXTRACTION,
  MODEL_CLASSIFICATION,
  MODEL_OCR,
  MODEL_RISK,
  MODEL_RESEARCH,
  MODEL_CLASSIC_SPREAD,
  MODEL_OMEGA,
  MODEL_RATES,
  MODEL_CONCIERGE_EXTRACTION,
} from "@/lib/ai/models";

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

// ── SPEC-EXTRACTION-MODEL-UPGRADE-1 — extraction lane on GA flagship Flash ──

test("[models-7] GEMINI_FLASH_PRECISION is gemini-3.5-flash", () => {
  assert.equal(GEMINI_FLASH_PRECISION, "gemini-3.5-flash");
});

test("[models-8] MODEL_EXTRACTION points at gemini-3.5-flash (the precision lane)", () => {
  assert.equal(MODEL_EXTRACTION, "gemini-3.5-flash");
  assert.equal(MODEL_EXTRACTION, GEMINI_FLASH_PRECISION);
});

test("[models-9] isGemini3Model matches gemini-3.5-flash (temperature omitted for 3.x)", () => {
  // Guards the buildGenerationConfig path: 3.x family must skip the temperature
  // field. gemini-3.5-flash must register as 3.x.
  assert.equal(isGemini3Model("gemini-3.5-flash"), true);
});

test("[models-10] every OTHER Gemini lane still resolves to Flash-Lite (blast radius)", () => {
  // SPEC HARD NON-GOAL: only the extraction lane moves. The eight other
  // GEMINI_FLASH-aliased lanes must remain on gemini-3.1-flash-lite.
  assert.equal(GEMINI_FLASH, "gemini-3.1-flash-lite");
  for (const [name, model] of [
    ["MODEL_RISK", MODEL_RISK],
    ["MODEL_CLASSIFICATION", MODEL_CLASSIFICATION],
    ["MODEL_RESEARCH", MODEL_RESEARCH],
    ["MODEL_OCR", MODEL_OCR],
    ["MODEL_CLASSIC_SPREAD", MODEL_CLASSIC_SPREAD],
    ["MODEL_OMEGA", MODEL_OMEGA],
    ["MODEL_RATES", MODEL_RATES],
    ["MODEL_CONCIERGE_EXTRACTION", MODEL_CONCIERGE_EXTRACTION],
  ] as const) {
    assert.equal(model, "gemini-3.1-flash-lite", `${name} drifted off Flash-Lite`);
  }
});
