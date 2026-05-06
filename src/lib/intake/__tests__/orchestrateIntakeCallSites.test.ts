/**
 * SPEC-INTAKE-V2 PR1 — Orchestrator Call-Site Audit CI Guards
 *
 * PIV-9 identified two real callers of orchestrateIntake():
 *   - src/app/api/deals/[dealId]/intake/run/route.ts
 *   - src/app/api/deals/[dealId]/auto-seed/route.ts
 *
 * The spec requires that any caller ignoring result.ok must be updated to
 * fail loudly — surface a banker-visible state, return a non-200 status,
 * or write a ledger event. These guards lock that contract structurally.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

describe("intake/run/route.ts honors result.ok", () => {
  const src = readFile("src/app/api/deals/[dealId]/intake/run/route.ts");

  test("Guard 1: route inspects result.ok", () => {
    assert.ok(
      src.includes("result?.ok") || src.includes("result.ok"),
      "intake/run/route.ts must inspect result.ok",
    );
  });

  test("Guard 2: failure branch flips intake_state to FAILED", () => {
    assert.ok(
      src.includes('intake_state: "FAILED"'),
      "Failure branch must set intake_state to FAILED",
    );
  });

  test("Guard 3: failure branch writes an orchestrator_critical_failure ledger event", () => {
    assert.ok(
      src.includes("intake.orchestrator_critical_failure"),
      "Failure branch must emit intake.orchestrator_critical_failure",
    );
  });

  test("Guard 4: failure response carries a non-200 status", () => {
    assert.ok(
      src.includes("status: result?.ok ? 200 : 500") ||
        src.includes("status: result.ok ? 200 : 500"),
      "Failure response must be non-200 so callers can react",
    );
  });
});

describe("auto-seed/route.ts honors result.ok", () => {
  const src = readFile("src/app/api/deals/[dealId]/auto-seed/route.ts");

  test("Guard 5: auto-seed captures the orchestrate result and inspects ok", () => {
    assert.ok(
      src.includes("orchestrateIntake({"),
      "auto-seed must call orchestrateIntake",
    );
    // Result must be captured in a variable (not fire-and-forget) so we can
    // inspect ok afterward.
    assert.ok(
      /const\s+orchResult\s*=\s*await\s+orchestrateIntake\(/.test(src),
      "auto-seed must capture orchestrate result",
    );
    assert.ok(
      src.includes("orchResult.ok") || src.includes("!orchResult.ok"),
      "auto-seed must inspect orchResult.ok",
    );
  });

  test("Guard 6: auto-seed writes a ledger event when orchestrator critically fails", () => {
    assert.ok(
      src.includes("deal.intake.orchestrator_critical_failure"),
      "auto-seed must emit deal.intake.orchestrator_critical_failure on !ok",
    );
  });

  test("Guard 7: auto-seed writes a ledger event when orchestrator throws", () => {
    assert.ok(
      src.includes("deal.intake.orchestrator_threw"),
      "auto-seed must emit deal.intake.orchestrator_threw in catch block",
    );
  });
});
