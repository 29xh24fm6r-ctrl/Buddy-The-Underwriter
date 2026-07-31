/**
 * Audit fix (Borrower Intake Program review) — structural tripwire
 * confirming generateSBAPackage actually calls
 * generateProjectionsAssumptionsNarrative and persists its result. This
 * file (900+ lines, dozens of DB/AI dependencies) has no full behavioral
 * test harness; this is a source-grep check, same convention as
 * businessPlanVerificationWiring.test.ts — it proves the wiring exists and
 * is correctly ordered/guarded, not that the narrative generator's own
 * logic is correct (that's covered in
 * src/lib/methodology/__tests__/projectionsAssumptionsNarrative.test.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(resolve(process.cwd(), "src/lib/sba/sbaPackageOrchestrator.ts"), "utf8");
}

test("TRIPWIRE: imports generateProjectionsAssumptionsNarrative", () => {
  const src = readSrc();
  assert.match(
    src,
    /import\s*\{\s*generateProjectionsAssumptionsNarrative\s*\}\s*from\s*["']@\/lib\/methodology\/projectionsAssumptionsNarrative["']/,
  );
});

test("TRIPWIRE: generateSBAPackage calls it and wraps the call in try/catch (non-fatal, like franchiseSection)", () => {
  const src = readSrc();
  const callIdx = src.indexOf("generateProjectionsAssumptionsNarrative(dealId, deal.bank_id, sb)");
  assert.ok(callIdx > -1, "call site not found");
  const before = src.slice(Math.max(0, callIdx - 600), callIdx);
  assert.match(before, /try\s*\{/, "call must be inside a try block — a bonus narrative must never fail the whole package");
});

test("TRIPWIRE: only a 'ready' result is persisted (degraded/unavailable must not leak a message string as narrative text)", () => {
  const src = readSrc();
  const callIdx = src.indexOf("generateProjectionsAssumptionsNarrative(dealId, deal.bank_id, sb)");
  assert.ok(callIdx > -1);
  const after = src.slice(callIdx, callIdx + 300);
  assert.match(after, /status === "ready"/);
});

test("TRIPWIRE: the resolved narrative is persisted to buddy_sba_packages.projections_assumptions_narrative", () => {
  const src = readSrc();
  assert.match(src, /projections_assumptions_narrative:\s*projectionsAssumptionsNarrative,/);
});

test("TRIPWIRE: the call site precedes the insert (so the value is available when the row is written)", () => {
  const src = readSrc();
  const callIdx = src.indexOf("generateProjectionsAssumptionsNarrative(dealId, deal.bank_id, sb)");
  const insertIdx = src.indexOf("projections_assumptions_narrative: projectionsAssumptionsNarrative,");
  assert.ok(callIdx > -1 && insertIdx > -1);
  assert.ok(callIdx < insertIdx);
});
