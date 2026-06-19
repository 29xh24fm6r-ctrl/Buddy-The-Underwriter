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

test("[c] true borrower_not_attached → Confirm borrower identity (not Attach borrower)", () => {
  // SPEC-BORROWER-ENTITY-SPONSOR-SEPARATION-1: when the legal borrower entity is
  // genuinely unidentified, the CTA confirms legal identity (routed to the
  // borrower-story memo-input surface) — never the old "Attach borrower" label
  // that pointed at the management/sponsor /borrower page.
  const action = getNextAction(
    stateWith([{ code: "borrower_not_attached", message: "x" }]),
    DEAL,
  );
  assert.equal(action.label, "Confirm borrower identity");
  assert.notEqual(action.label, "Attach borrower");
  assert.ok(
    typeof (action as any).href === "string" &&
      !/\/borrower\b/.test((action as any).href),
    "borrower_not_attached must not route to the management/sponsor /borrower page",
  );
});

test("deriveLifecycleState gates borrower_not_attached on legal borrower identity", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/buddy/lifecycle/deriveLifecycleState.ts"),
    "utf8",
  );
  // SPEC-BORROWER-ENTITY-SPONSOR-SEPARATION-1: must gate on legal borrower
  // identity (borrower_id / display fields / story legal_name), NOT on the broad
  // representation check that counted management/sponsor profiles.
  assert.ok(
    /hasLegalBorrowerIdentityForDeal/.test(src),
    "borrower_not_attached must be gated on legal borrower identity",
  );
  assert.ok(
    !/hasBorrowerRepresentation/.test(src),
    "must no longer use the broad representation check (management profile must not satisfy legal identity)",
  );
  // Must surface the authoritative memo-input blockers so the rail advances.
  assert.ok(
    /memoInputBlockers/.test(src),
    "deriveLifecycleState must surface memo-input blockers into state.blockers",
  );
});
