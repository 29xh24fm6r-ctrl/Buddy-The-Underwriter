/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 (audit fix) — structural tripwire confirming
 * generatePackageAction actually calls enrichBusinessPlanPackage after a
 * successful generateSBAPackage call. This route file (1600+ lines) has no
 * behavioral test harness; this is a source-grep check, not a request/
 * response test — it can prove the wiring exists and is positioned after
 * the ok-check, but not that enrichBusinessPlanPackage's own logic is
 * correct (that's covered separately in enrichBusinessPlanPackage.test.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(resolve(process.cwd(), "src/app/api/deals/[dealId]/sba/route.ts"), "utf8");
}

test("TRIPWIRE: imports enrichBusinessPlanPackage", () => {
  const src = readSrc();
  assert.match(src, /import\s*\{\s*enrichBusinessPlanPackage\s*\}\s*from\s*["']@\/lib\/sba\/enrichBusinessPlanPackage["']/);
});

test("TRIPWIRE: generatePackageAction calls enrichBusinessPlanPackage AFTER the result.ok check", () => {
  const src = readSrc();
  const fnIdx = src.indexOf("async function generatePackageAction");
  assert.ok(fnIdx > -1);
  const fnBody = src.slice(fnIdx);

  const okCheckIdx = fnBody.indexOf("if (!result.ok)");
  const enrichCallIdx = fnBody.indexOf("enrichBusinessPlanPackage({");
  assert.ok(okCheckIdx > -1 && enrichCallIdx > -1);
  assert.ok(okCheckIdx < enrichCallIdx, "verification must run only after generation is confirmed successful");
});

test("TRIPWIRE: the enrichment call is wrapped in its own try/catch (non-fatal)", () => {
  const src = readSrc();
  const enrichIdx = src.indexOf("enrichBusinessPlanPackage({");
  assert.ok(enrichIdx > -1);
  const before = src.slice(Math.max(0, enrichIdx - 400), enrichIdx);
  assert.match(before, /try\s*\{/);
});
