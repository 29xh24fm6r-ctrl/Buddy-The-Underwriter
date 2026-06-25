/**
 * SPEC-LIFECYCLE-CHECKLIST-READINESS-CANONICAL-FLOW-1 — Required tests #3, #4, #7.
 *
 * Wiring guards that fail CI if the canonical readiness/lifecycle path stops
 * running checklist-satisfaction reconciliation before document blockers are
 * counted/derived. These are source-pattern guards because the surfaces are
 * server-only (DB-backed); the behavioral logic is covered by
 * reconcileChecklistSatisfaction.test.ts and staleBlockerGuards.test.ts.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf-8");

const MEMO_SRC = read("../../../creditMemo/inputs/buildMemoInputPackage.ts");
const SELFHEAL_SRC = read("../selfHealDeal.ts");
const LIFECYCLE_SRC = read("../../../../buddy/lifecycle/deriveLifecycleState.ts");
const ENGINE_SRC = read("../../../checklist/engine.ts");

describe("canonical readiness runs checklist satisfaction before doc count (#3/#7)", () => {
  test("buildMemoInputPackage references the satisfaction helper", () => {
    assert.ok(
      MEMO_SRC.includes("reconcileChecklistSatisfactionForDeal"),
      "buildMemoInputPackage must run checklist satisfaction reconciliation",
    );
  });

  test("the satisfaction reconciliation runs BEFORE unfinalized doc count", () => {
    const satIdx = MEMO_SRC.indexOf("reconcileChecklistSatisfactionForDeal");
    const countIdx = MEMO_SRC.indexOf("loadUnfinalizedRequiredDocCount(sb");
    assert.ok(satIdx > -1 && countIdx > -1, "both markers must be present");
    assert.ok(
      satIdx < countIdx,
      "checklist satisfaction must run before loadUnfinalizedRequiredDocCount is invoked",
    );
  });

  test("it is gated on runReconciliation", () => {
    // The helper call lives inside the `if (args.runReconciliation)` block.
    const guardIdx = MEMO_SRC.indexOf("if (args.runReconciliation)");
    const satIdx = MEMO_SRC.indexOf("reconcileChecklistSatisfactionForDeal");
    assert.ok(guardIdx > -1 && satIdx > guardIdx, "satisfaction must be gated on runReconciliation");
  });
});

describe("selfHealDeal wires checklist satisfaction (#4)", () => {
  test("selfHealDeal calls the satisfaction helper", () => {
    assert.ok(
      SELFHEAL_SRC.includes("reconcileChecklistSatisfactionForDeal"),
      "selfHealDeal must run the checklist satisfaction self-heal",
    );
  });

  test("self-heal report exposes checklistSatisfaction", () => {
    assert.ok(
      SELFHEAL_SRC.includes("checklistSatisfaction"),
      "SelfHealReport must include a checklistSatisfaction field",
    );
  });

  test("self-heal invalidates lifecycle cache when an item is repaired", () => {
    assert.ok(
      SELFHEAL_SRC.includes("invalidateLifecycleCache"),
      "self-heal must drop the lifecycle cache when itemsMarkedReceived > 0",
    );
  });
});

describe("lifecycle + engine convergence wiring", () => {
  test("deriveLifecycleState applies the stale unfinalized-docs guard", () => {
    assert.ok(
      LIFECYCLE_SRC.includes("suppressStaleUnfinalizedDocsBlocker"),
      "deriveLifecycleState must suppress stale unfinalized_required_documents",
    );
  });

  test("reconcileChecklistForDeal delegates to the shared satisfaction helper", () => {
    assert.ok(
      ENGINE_SRC.includes("reconcileChecklistSatisfactionForDeal"),
      "engine must delegate the evidence-only rule to the shared helper (no duplication)",
    );
  });
});
