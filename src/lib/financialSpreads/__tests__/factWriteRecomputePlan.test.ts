import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { planFactWriteRecomputeSpreadTypes } from "../factWriteRecomputePlan";
import {
  filterOptionalSpreadsForDefaultRecompute,
  isOptionalSpreadType,
} from "@/lib/spreads/t12Eligibility";
import { ALL_SPREAD_TYPES, type SpreadType } from "@/lib/financialSpreads/types";

/**
 * SPEC-SPREAD-SYSTEM-PERFECTION-HARDENING-1 (Phase 2).
 *
 * The internal fact-write recompute (writeFactsBatch) used to enqueue
 * ["T12", "BALANCE_SHEET", "GLOBAL_CASH_FLOW"] unconditionally — an explicit
 * request that bypassed the default T12 filter (#556) and could orphan a GCF
 * row before its prerequisites existed (#554). The pure planner now gates both.
 */

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.resolve(root, rel), "utf8");

// ── pure planner ────────────────────────────────────────────────────────────

test("AC1: no T12/monthly source + GCF prereqs missing → primary spreads only (BALANCE_SHEET + STANDARD)", () => {
  const types = planFactWriteRecomputeSpreadTypes({
    hasT12Source: false,
    gcfPrerequisitesReady: false,
  });
  assert.deepEqual(types.sort(), ["BALANCE_SHEET", "STANDARD"]);
  assert.ok(!types.includes("T12" as SpreadType), "annual-statement fact write must not enqueue T12");
  assert.ok(!types.includes("GLOBAL_CASH_FLOW" as SpreadType), "must not enqueue GCF before prereqs");
});

test("Tier-8: STANDARD (Financial Analysis) is always a candidate so fact edits keep it fresh", () => {
  for (const t12 of [false, true]) {
    for (const gcf of [false, true]) {
      assert.ok(
        planFactWriteRecomputeSpreadTypes({ hasT12Source: t12, gcfPrerequisitesReady: gcf }).includes(
          "STANDARD" as SpreadType,
        ),
        "STANDARD (primary document-derived spread) must always be a candidate",
      );
    }
  }
});

test("AC2: T12 enqueued only when a real T12/monthly source exists", () => {
  const without = planFactWriteRecomputeSpreadTypes({ hasT12Source: false, gcfPrerequisitesReady: false });
  assert.ok(!without.includes("T12" as SpreadType));
  const withSource = planFactWriteRecomputeSpreadTypes({ hasT12Source: true, gcfPrerequisitesReady: false });
  assert.ok(withSource.includes("T12" as SpreadType), "real T12/monthly source allows T12");
});

test("AC3: GCF enqueued only when prerequisites are ready", () => {
  const notReady = planFactWriteRecomputeSpreadTypes({ hasT12Source: false, gcfPrerequisitesReady: false });
  assert.ok(!notReady.includes("GLOBAL_CASH_FLOW" as SpreadType));
  const ready = planFactWriteRecomputeSpreadTypes({ hasT12Source: false, gcfPrerequisitesReady: true });
  assert.ok(ready.includes("GLOBAL_CASH_FLOW" as SpreadType), "ready prereqs allow GCF");
});

test("BALANCE_SHEET is always a candidate; both gates open → all three", () => {
  for (const t12 of [false, true]) {
    for (const gcf of [false, true]) {
      assert.ok(
        planFactWriteRecomputeSpreadTypes({ hasT12Source: t12, gcfPrerequisitesReady: gcf }).includes(
          "BALANCE_SHEET" as SpreadType,
        ),
        "BALANCE_SHEET (primary) always present",
      );
    }
  }
  assert.deepEqual(
    planFactWriteRecomputeSpreadTypes({ hasT12Source: true, gcfPrerequisitesReady: true }).sort(),
    ["BALANCE_SHEET", "GLOBAL_CASH_FLOW", "STANDARD", "T12"],
  );
});

test("the gated optional spread is exactly T12 (ties to #556)", () => {
  const onlyWithSource = planFactWriteRecomputeSpreadTypes({ hasT12Source: true, gcfPrerequisitesReady: false })
    .filter((t) => isOptionalSpreadType(t));
  assert.deepEqual(onlyWithSource, ["T12"]);
  const none = planFactWriteRecomputeSpreadTypes({ hasT12Source: false, gcfPrerequisitesReady: false })
    .filter((t) => isOptionalSpreadType(t));
  assert.deepEqual(none, []);
});

// ── #556 default-recompute behavior must remain unchanged ─────────────────────

test("AC4: #556 default recompute T12 behavior is unchanged", () => {
  const defaulted = filterOptionalSpreadsForDefaultRecompute([...ALL_SPREAD_TYPES], { hasOptionalSource: false });
  assert.ok(!defaulted.includes("T12" as SpreadType), "default recompute still drops T12 without a source");
  const withSource = filterOptionalSpreadsForDefaultRecompute([...ALL_SPREAD_TYPES], { hasOptionalSource: true });
  assert.ok(withSource.includes("T12" as SpreadType), "default recompute still keeps T12 with a source");
});

// ── writeFactsBatch wiring guard (source scan) ───────────────────────────────

test("writeFactsBatch wires both gates and no longer hardcodes the T12/GCF list", () => {
  const src = read("src/lib/financialSpreads/extractors/shared.ts");
  assert.ok(
    !/spreadTypes:\s*\[\s*"T12",\s*"BALANCE_SHEET",\s*"GLOBAL_CASH_FLOW"\s*\]/.test(src),
    "the unconditional [T12, BALANCE_SHEET, GLOBAL_CASH_FLOW] enqueue must be gone",
  );
  assert.ok(src.includes("planFactWriteRecomputeSpreadTypes"), "must use the pure planner");
  assert.ok(src.includes("dealHasT12Source"), "must resolve the real-T12-source gate (#556)");
  assert.ok(src.includes("getCanonicalGlobalCashFlow"), "must resolve GCF prerequisites (#554)");
  assert.ok(src.includes("gcfPrerequisitesReady"), "must pass GCF readiness into the planner");
});
