/**
 * SPEC-INTAKE-V2 PR1 — Orchestrator Critical-Step Contract CI Guards
 *
 * PIV-2 confirmed orchestrateIntake.ts returned a hardcoded `ok: true` at the
 * final return (line 391, pre-fix). PR1 introduces a critical/non-critical
 * step contract: failures in critical steps must propagate to the return value
 * as ok=false plus a populated criticalFailures array.
 *
 * These guards lock the contract structurally so future edits can't silently
 * regress to the old "always ok" behavior.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

describe("orchestrateIntake critical-step contract", () => {
  const src = readFile("src/lib/intake/orchestrateIntake.ts");

  test("Guard 1: CRITICAL_STEPS set is declared", () => {
    assert.ok(
      src.includes("const CRITICAL_STEPS"),
      "orchestrateIntake.ts must declare CRITICAL_STEPS",
    );
    assert.ok(
      src.includes("new Set<string>([") ||
        src.includes("new Set([") ||
        src.includes("new Set<string>(["),
      "CRITICAL_STEPS must be a Set",
    );
  });

  test("Guard 2: CRITICAL_STEPS includes the four required step names", () => {
    for (const stepName of [
      "ensure_checklist_seeded",
      "ensure_slots",
      "gatekeeper_classify",
      "advance_lifecycle",
    ]) {
      assert.ok(
        src.includes(`"${stepName}"`),
        `CRITICAL_STEPS must reference "${stepName}"`,
      );
    }
  });

  test("Guard 3: criticalFailures array is tracked inside orchestrateIntake", () => {
    assert.ok(
      src.includes("const criticalFailures"),
      "orchestrateIntake must track a criticalFailures array",
    );
    assert.ok(
      src.includes("CRITICAL_STEPS.has(name)"),
      "step() must check CRITICAL_STEPS.has(name) before pushing failures",
    );
    assert.ok(
      src.includes("criticalFailures.push("),
      "step() must push into criticalFailures on critical failure",
    );
  });

  test("Guard 4: final return is no longer hardcoded ok: true", () => {
    // The buggy pre-PR1 return was a literal `ok: true,` followed by dealId.
    // The fixed return derives ok from criticalFailures.length === 0.
    assert.ok(
      src.includes("ok: criticalFailures.length === 0"),
      "Final return must derive ok from criticalFailures.length === 0",
    );
    // Negative guard: ensure no remaining hardcoded `ok: true,` in the return block.
    // (We allow it inside diagnostics.steps.push since each step records its own ok flag.)
    const returnBlockMatch = src.match(
      /return\s*\{\s*ok:[^,]+,[\s\S]*?diagnostics,[\s\S]*?\};\s*\}\s*$/m,
    );
    assert.ok(
      returnBlockMatch,
      "Final return block must be present and well-formed",
    );
    assert.ok(
      !returnBlockMatch![0].includes("ok: true,"),
      "Final return must not hardcode ok: true",
    );
  });

  test("Guard 5: criticalFailures field is exposed in OrchestrateIntakeResult type", () => {
    assert.ok(
      src.includes("criticalFailures?: string[]"),
      "OrchestrateIntakeResult must expose criticalFailures?: string[]",
    );
  });

  test("Guard 6: criticalFailures is included in the returned object", () => {
    assert.ok(
      src.includes(
        "criticalFailures: criticalFailures.length > 0 ? criticalFailures : undefined",
      ),
      "Final return must include criticalFailures when populated",
    );
  });
});

describe("orchestrateIntake ensure_slots wiring (PR1 Fix 2a)", () => {
  const src = readFile("src/lib/intake/orchestrateIntake.ts");

  test("Guard 7: ensure_slots step is registered with the orchestrator", () => {
    assert.ok(
      src.includes('await step("ensure_slots"'),
      "orchestrateIntake must call step(\"ensure_slots\", ...)",
    );
  });

  test("Guard 8: ensure_slots delegates to ensureCoreDocumentSlots", () => {
    assert.ok(
      src.includes("ensureCoreDocumentSlots"),
      "ensure_slots step must use ensureCoreDocumentSlots",
    );
    assert.ok(
      src.includes('"@/lib/intake/slots/ensureCoreDocumentSlots"'),
      "ensure_slots must dynamic-import from @/lib/intake/slots/ensureCoreDocumentSlots",
    );
  });

  test("Guard 9: ensure_slots throws on failure so the critical-step contract trips", () => {
    // The step must throw on !result.ok so step()'s catch block records it
    // in criticalFailures. A silent return would leave deals slot-less.
    // We slice from the ensure_slots step opening to the next `await step(`
    // (gatekeeper_classify) so we're scoped to just this step's body.
    const startIdx = src.indexOf('await step("ensure_slots"');
    const nextStepIdx = src.indexOf(
      'await step("gatekeeper_classify"',
      startIdx,
    );
    assert.ok(
      startIdx >= 0 && nextStepIdx > startIdx,
      "ensure_slots step block must exist and precede gatekeeper_classify",
    );
    const ensureSlotsBody = src.slice(startIdx, nextStepIdx);
    assert.ok(
      ensureSlotsBody.includes("throw new Error"),
      "ensure_slots must throw on result.ok === false (body had no throw)",
    );
    assert.ok(
      ensureSlotsBody.includes("!result.ok") ||
        ensureSlotsBody.includes("result.ok === false"),
      "ensure_slots must inspect result.ok before throwing",
    );
  });

  test("Guard 10: ensure_slots runs after ensure_checklist_seeded and before gatekeeper_classify", () => {
    const seededIdx = src.indexOf('await step("ensure_checklist_seeded"');
    const slotsIdx = src.indexOf('await step("ensure_slots"');
    const gatekeeperIdx = src.indexOf('await step("gatekeeper_classify"');

    assert.ok(seededIdx >= 0, "ensure_checklist_seeded step must exist");
    assert.ok(slotsIdx >= 0, "ensure_slots step must exist");
    assert.ok(gatekeeperIdx >= 0, "gatekeeper_classify step must exist");

    assert.ok(
      seededIdx < slotsIdx,
      "ensure_slots must run after ensure_checklist_seeded (scenario row may be required)",
    );
    assert.ok(
      slotsIdx < gatekeeperIdx,
      "ensure_slots must run before gatekeeper_classify",
    );
  });
});
