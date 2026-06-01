import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getNextAction } from "@/buddy/lifecycle/nextAction";
import type { LifecycleBlocker, LifecycleState } from "@/buddy/lifecycle/model";

/**
 * SPEC-JOURNEY-RAIL-NEXT-ACTION-SOURCE-OF-TRUTH-1
 *
 * The rail's current action is getNextAction(state) — it maps the TOP blocker to
 * a specific CTA. The bug was in deriveLifecycleState, which (a) emitted
 * borrower_not_attached purely from deals.borrower_id (a FK the borrower-profile
 * flow never sets), masking the real task, and (b) never surfaced the memo-input
 * blockers, so research/management never reached the rail. These tests lock in
 * the getNextAction mapping (the contract the rail relies on) and guard the
 * deriveLifecycleState source fix.
 */

const DEAL = "deal-abc";

function stateWith(blockers: LifecycleBlocker[]): LifecycleState {
  return {
    stage: "underwrite_in_progress",
    lastAdvancedAt: null,
    blockers,
    derived: {} as any,
  };
}

test("[a] missing_management_profile → Add management profile", () => {
  const action = getNextAction(
    stateWith([{ code: "missing_management_profile", message: "x" }]),
    DEAL,
  );
  assert.equal(action.label, "Add management profile");
  assert.notEqual(action.label, "Attach borrower");
});

test("[b] management complete + missing_research_quality_gate → research action, not Attach borrower", () => {
  const action = getNextAction(
    stateWith([{ code: "missing_research_quality_gate", message: "x" }]),
    DEAL,
  );
  assert.equal(action.label, "Run research");
  assert.notEqual(action.label, "Attach borrower");
  assert.ok(
    typeof (action as any).href === "string" &&
      /\/(research|underwrite)\b/.test((action as any).href),
    "research CTA should route to the research/underwrite page",
  );
});

test("[c] true borrower_not_attached → Attach borrower remains valid", () => {
  const action = getNextAction(
    stateWith([{ code: "borrower_not_attached", message: "x" }]),
    DEAL,
  );
  assert.equal(action.label, "Attach borrower");
});

test("deriveLifecycleState gates borrower_not_attached on real borrower representation", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/buddy/lifecycle/deriveLifecycleState.ts"),
    "utf8",
  );
  // Must no longer fire purely on !borrower_id.
  assert.ok(
    /hasBorrowerRepresentation/.test(src),
    "borrower_not_attached must be gated on borrower representation, not bare borrower_id",
  );
  assert.ok(
    /deal_management_profiles/.test(src) && /deal_borrower_story/.test(src),
    "representation check must consider the borrower-profile flow's tables",
  );
  // Must surface the authoritative memo-input blockers so the rail advances.
  assert.ok(
    /memoInputBlockers/.test(src),
    "deriveLifecycleState must surface memo-input blockers into state.blockers",
  );
});
