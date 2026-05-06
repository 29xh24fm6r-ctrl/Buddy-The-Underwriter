/**
 * UnifiedDealReadiness — pure unifier tests.
 *
 * Invariants:
 *   1. docs ready + memo inputs missing → stage memo_inputs_required, top blocker = memo_inputs
 *   2. memo inputs complete → next action "Review Credit Memo"
 *   3. missing borrower story → top action "Complete borrower story"
 *   4. missing collateral → top action "Add collateral value" (collateral_complete derived from items+value)
 *   5. submitted snapshot → next action "View submitted memo"
 *   6. finalized snapshot → next action "View finalized memo"
 *   7. score is bounded [0, 100]
 */

import test from "node:test";
import assert from "node:assert/strict";

import { unifyDealReadiness } from "@/lib/deals/readiness/unifyDealReadiness";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { MemoInputReadiness } from "@/lib/creditMemo/inputs/types";

const DEAL_ID = "deal-test";

function lifecycle(over: Partial<LifecycleState> = {}): LifecycleState {
  return {
    stage: "memo_inputs_required",
    lastAdvancedAt: null,
    blockers: [],
    derived: {
      documentsReady: true,
      documentsReadinessPct: 100,
      underwriteStarted: false,
      financialSnapshotExists: true,
      committeePacketReady: false,
      decisionPresent: false,
      committeeRequired: true,
      pricingQuoteReady: false,
      riskPricingFinalized: false,
      attestationSatisfied: false,
      aiPipelineComplete: true,
      spreadsComplete: true,
      structuralPricingReady: true,
      hasPricingAssumptions: true,
      hasSubmittedLoanRequest: true,
      hasLoanRequestWithAmount: true,
      researchComplete: true,
      criticalFlagsResolved: true,
    },
    ...over,
  };
}

function readyMemoInput(): MemoInputReadiness {
  return {
    ready: true,
    borrower_story_complete: true,
    management_complete: true,
    collateral_complete: true,
    financials_complete: true,
    research_complete: true,
    conflicts_resolved: true,
    readiness_score: 100,
    blockers: [],
    warnings: [],
    evaluatedAt: new Date().toISOString(),
    contractVersion: "memo_input_v1",
  };
}

function blockedMemoInput(over: Partial<MemoInputReadiness> = {}): MemoInputReadiness {
  return {
    ready: false,
    borrower_story_complete: false,
    management_complete: false,
    collateral_complete: false,
    financials_complete: true,
    research_complete: true,
    conflicts_resolved: true,
    readiness_score: 50,
    blockers: [
      {
        code: "missing_business_description",
        label: "Business description is required",
        owner: "banker",
        fixPath: `/deals/${DEAL_ID}/memo-inputs#borrower-story`,
      },
    ],
    warnings: [],
    evaluatedAt: new Date().toISOString(),
    contractVersion: "memo_input_v1",
    ...over,
  };
}

const NOT_SUBMITTED = { submitted: false, snapshotId: null, finalized: false };
const SUBMITTED = { submitted: true, snapshotId: "snap-1", finalized: false };
const FINALIZED = { submitted: true, snapshotId: "snap-1", finalized: true };

// ───────────────────────────────────────────────────────────────────────

test("[unified-1] docs ready + memo inputs missing → memo_inputs blocker top", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: blockedMemoInput(),
    creditMemo: NOT_SUBMITTED,
  });
  assert.equal(r.ready, false);
  assert.equal(r.next_action.label, "Business description is required");
  assert.equal(r.next_action.kind, "fix");
  assert.equal(r.groups.memo_inputs.ready, false);
});

test("[unified-2] memo inputs complete → next_action 'Review Credit Memo'", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle({ stage: "memo_inputs_required" }),
    memoInput: readyMemoInput(),
    creditMemo: NOT_SUBMITTED,
  });
  assert.equal(r.ready, true);
  assert.equal(r.next_action.label, "Review Credit Memo");
  assert.match(r.next_action.href, /\/credit-memo$/);
});

test("[unified-3] missing borrower story → top action 'Complete borrower story' fixPath", () => {
  const memo = blockedMemoInput({
    blockers: [
      {
        code: "missing_business_description",
        label: "Complete borrower story",
        owner: "banker",
        fixPath: `/deals/${DEAL_ID}/memo-inputs#borrower-story`,
      },
    ],
  });
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: memo,
    creditMemo: NOT_SUBMITTED,
  });
  assert.equal(r.next_action.label, "Complete borrower story");
  assert.match(r.next_action.href, /memo-inputs#borrower-story$/);
});

test("[unified-4] missing collateral value → top action with collateral fixPath", () => {
  const memo = blockedMemoInput({
    blockers: [
      {
        code: "missing_collateral_value",
        label: "Add collateral value",
        owner: "banker",
        fixPath: `/deals/${DEAL_ID}/memo-inputs#collateral`,
      },
    ],
  });
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: memo,
    creditMemo: NOT_SUBMITTED,
  });
  assert.equal(r.next_action.label, "Add collateral value");
  assert.match(r.next_action.href, /memo-inputs#collateral$/);
});

test("[unified-5] submitted snapshot → next_action 'View submitted memo'", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle({ stage: "underwrite_in_progress" }),
    memoInput: readyMemoInput(),
    creditMemo: SUBMITTED,
  });
  assert.equal(r.next_action.label, "View submitted memo");
});

test("[unified-6] finalized snapshot → next_action 'View finalized memo'", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle({ stage: "committee_decisioned" }),
    memoInput: readyMemoInput(),
    creditMemo: FINALIZED,
  });
  assert.equal(r.next_action.label, "View finalized memo");
});

test("[unified-7] aggregate score is bounded [0, 100]", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: blockedMemoInput({ readiness_score: -50 }),
    creditMemo: NOT_SUBMITTED,
  });
  assert.ok(r.score >= 0);
  assert.ok(r.score <= 100);
});

test("[unified-8] memo input readiness null → memo_inputs blocker", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: null,
    creditMemo: NOT_SUBMITTED,
  });
  assert.ok(r.blockers.some((b) => b.group === "memo_inputs"));
});

test("[unified-9] documents-stage blockers route into documents group", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle({
      stage: "docs_in_progress",
      blockers: [
        {
          code: "gatekeeper_docs_incomplete",
          message: "Documents missing",
          evidence: {},
        },
      ],
      derived: { ...lifecycle().derived, documentsReady: false, documentsReadinessPct: 50 },
    }),
    memoInput: null,
    creditMemo: NOT_SUBMITTED,
  });
  assert.ok(r.groups.documents.blockers.some((b) => b.code === "gatekeeper_docs_incomplete"));
  // Documents priority beats memo_inputs.
  assert.equal(r.next_action.kind, "fix");
  assert.equal(r.groups.documents.ready, false);
});
