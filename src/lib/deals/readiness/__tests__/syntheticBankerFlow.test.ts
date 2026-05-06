/**
 * Synthetic E2E for the Banker Flow v1.1.
 *
 * Walks one fixture deal through the full happy path using the pure
 * `unifyDealReadiness` combiner. The test asserts that each step produces
 * the expected `next_action` so a future regression in the rail's CTA copy
 * fails immediately.
 *
 * The flow:
 *
 *    1. Brand new deal — no docs, no facts, no memo inputs
 *       → next_action: "Complete Memo Inputs" (or earlier doc step)
 *
 *    2. Docs finalized + facts written — memo inputs still empty
 *       → next_action: "Complete borrower story" (or first memo blocker)
 *
 *    3. Memo inputs filled in — readiness = 100
 *       → next_action: "Review Credit Memo"
 *
 *    4. Banker submits memo — credit_memo.submitted = true
 *       → next_action: "View submitted memo"
 *
 *    5. Underwriter finalizes
 *       → next_action: "View finalized memo"
 *
 * No DB, no network. Exercises the actual logic the JourneyRail and
 * DealShellMemoCta consume.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { unifyDealReadiness } from "@/lib/deals/readiness/unifyDealReadiness";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { MemoInputReadiness } from "@/lib/creditMemo/inputs/types";

const DEAL_ID = "deal-synthetic";

// ── Fixture builders ────────────────────────────────────────────────────────

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
      memoInputsReady: false,
    },
    ...over,
  };
}

function memoInputBlocked(): MemoInputReadiness {
  return {
    ready: false,
    borrower_story_complete: false,
    management_complete: false,
    collateral_complete: false,
    financials_complete: true,
    research_complete: true,
    conflicts_resolved: true,
    readiness_score: 60,
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
  };
}

function memoInputReady(): MemoInputReadiness {
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

const NOT_SUBMITTED = { submitted: false, snapshotId: null, finalized: false };
const SUBMITTED = { submitted: true, snapshotId: "snap-1", finalized: false };
const FINALIZED = { submitted: true, snapshotId: "snap-1", finalized: true };

// ────────────────────────────────────────────────────────────────────────────
// Step 1 — fresh deal, no memo inputs
// ────────────────────────────────────────────────────────────────────────────

test("[synthetic-1] step 1: fresh deal — top action is the first memo blocker", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: memoInputBlocked(),
    creditMemo: NOT_SUBMITTED,
  });
  assert.equal(r.ready, false);
  assert.equal(r.next_action.kind, "fix");
  assert.equal(r.next_action.label, "Business description is required");
  assert.match(r.next_action.href, /memo-inputs#borrower-story$/);
});

// ────────────────────────────────────────────────────────────────────────────
// Step 2 — docs/facts ready, memo inputs partially filled
// ────────────────────────────────────────────────────────────────────────────

test("[synthetic-2] step 2: docs ready + memo partial — top action remains specific (not 'Resolve Blockers')", () => {
  const memo = memoInputBlocked();
  memo.borrower_story_complete = true;
  memo.blockers = [
    {
      code: "missing_management_profile",
      label: "Add management profile",
      owner: "banker",
      fixPath: `/deals/${DEAL_ID}/memo-inputs#management`,
    },
  ];
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: memo,
    creditMemo: NOT_SUBMITTED,
  });
  assert.equal(r.next_action.label, "Add management profile");
  assert.notEqual(r.next_action.label, "Resolve Blockers");
});

// ────────────────────────────────────────────────────────────────────────────
// Step 3 — readiness = 100
// ────────────────────────────────────────────────────────────────────────────

test("[synthetic-3] step 3: readiness 100 — next action 'Review Credit Memo'", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: memoInputReady(),
    creditMemo: NOT_SUBMITTED,
  });
  assert.equal(r.ready, true);
  assert.equal(r.next_action.label, "Review Credit Memo");
  assert.match(r.next_action.href, /\/credit-memo$/);
});

// ────────────────────────────────────────────────────────────────────────────
// Step 4 — banker submitted
// ────────────────────────────────────────────────────────────────────────────

test("[synthetic-4] step 4: submitted — next action 'View submitted memo'", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle({ stage: "underwrite_in_progress" }),
    memoInput: memoInputReady(),
    creditMemo: SUBMITTED,
  });
  assert.equal(r.next_action.label, "View submitted memo");
  assert.match(r.next_action.href, /\/credit-memo$/);
});

// ────────────────────────────────────────────────────────────────────────────
// Step 5 — underwriter finalized
// ────────────────────────────────────────────────────────────────────────────

test("[synthetic-5] step 5: finalized — next action 'View finalized memo'", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle({ stage: "committee_decisioned" }),
    memoInput: memoInputReady(),
    creditMemo: FINALIZED,
  });
  assert.equal(r.next_action.label, "View finalized memo");
});

// ────────────────────────────────────────────────────────────────────────────
// Recovery — self-heal flags surface as banker-readable blockers
// ────────────────────────────────────────────────────────────────────────────

test("[synthetic-6] recovery: stuck documents → 'Buddy is still processing documents…' blocker", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle({
      stage: "docs_in_progress",
      derived: { ...lifecycle().derived, documentsReady: false, documentsReadinessPct: 40 },
    }),
    memoInput: null,
    creditMemo: NOT_SUBMITTED,
    selfHeal: {
      detected: {
        documentsProcessingStalled: true,
        researchMissing: false,
        financialSnapshotStale: false,
        collateralExtractionNeeded: false,
        memoPrefillStale: false,
      },
    },
  });
  const stuck = r.groups.documents.blockers.find(
    (b) => b.code === "documents_processing_stalled",
  );
  assert.ok(stuck, "documents group must include documents_processing_stalled");
  assert.match(
    stuck!.label,
    /processing|stalled/i,
    "label must read like banker English, not a code",
  );
});

test("[synthetic-7] recovery: research missing → 'Buddy needs to run research…' blocker", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: memoInputReady(),
    creditMemo: NOT_SUBMITTED,
    selfHeal: {
      detected: {
        documentsProcessingStalled: false,
        researchMissing: true,
        financialSnapshotStale: false,
        collateralExtractionNeeded: false,
        memoPrefillStale: false,
      },
    },
  });
  const stalled = r.groups.research.blockers.find(
    (b) => b.code === "research_stalled",
  );
  assert.ok(stalled, "research group must include research_stalled");
  assert.match(stalled!.label, /research/i);
});

test("[synthetic-8] recovery: stale financial snapshot → recompute blocker", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: memoInputReady(),
    creditMemo: NOT_SUBMITTED,
    selfHeal: {
      detected: {
        documentsProcessingStalled: false,
        researchMissing: false,
        financialSnapshotStale: true,
        collateralExtractionNeeded: false,
        memoPrefillStale: false,
      },
    },
  });
  const stale = r.groups.financials.blockers.find(
    (b) => b.code === "financial_snapshot_stale_recovery",
  );
  assert.ok(stale, "financials group must include financial_snapshot_stale_recovery");
  assert.match(stale!.label, /stale|recompute/i);
});

test("[synthetic-9] recovery: collateral extraction needed → memo_inputs blocker with collateral fixPath", () => {
  const r = unifyDealReadiness({
    dealId: DEAL_ID,
    lifecycle: lifecycle(),
    memoInput: memoInputReady(),
    creditMemo: NOT_SUBMITTED,
    selfHeal: {
      detected: {
        documentsProcessingStalled: false,
        researchMissing: false,
        financialSnapshotStale: false,
        collateralExtractionNeeded: true,
        memoPrefillStale: false,
      },
    },
  });
  const collExt = r.groups.memo_inputs.blockers.find(
    (b) => b.code === "collateral_extraction_needed",
  );
  assert.ok(collExt, "memo_inputs must include collateral_extraction_needed");
  assert.match(collExt!.fixPath, /memo-inputs#collateral$/);
});

// ────────────────────────────────────────────────────────────────────────────
// Invariant: no generic "Resolve Blockers" anywhere in next_action.label
// ────────────────────────────────────────────────────────────────────────────

test("[synthetic-10] no path produces a generic 'Resolve Blockers' next_action", () => {
  // Enumerate every reachable state and assert the label is specific.
  const fixtures: Array<{ name: string; args: Parameters<typeof unifyDealReadiness>[0] }> = [
    {
      name: "fresh",
      args: {
        dealId: DEAL_ID,
        lifecycle: lifecycle(),
        memoInput: memoInputBlocked(),
        creditMemo: NOT_SUBMITTED,
      },
    },
    {
      name: "docs-stalled",
      args: {
        dealId: DEAL_ID,
        lifecycle: lifecycle({
          stage: "docs_in_progress",
          derived: { ...lifecycle().derived, documentsReady: false },
        }),
        memoInput: null,
        creditMemo: NOT_SUBMITTED,
        selfHeal: {
          detected: {
            documentsProcessingStalled: true,
            researchMissing: false,
            financialSnapshotStale: false,
            collateralExtractionNeeded: false,
            memoPrefillStale: false,
          },
        },
      },
    },
    {
      name: "research-missing",
      args: {
        dealId: DEAL_ID,
        lifecycle: lifecycle(),
        memoInput: memoInputReady(),
        creditMemo: NOT_SUBMITTED,
        selfHeal: {
          detected: {
            documentsProcessingStalled: false,
            researchMissing: true,
            financialSnapshotStale: false,
            collateralExtractionNeeded: false,
            memoPrefillStale: false,
          },
        },
      },
    },
    {
      name: "submitted",
      args: {
        dealId: DEAL_ID,
        lifecycle: lifecycle({ stage: "underwrite_in_progress" }),
        memoInput: memoInputReady(),
        creditMemo: SUBMITTED,
      },
    },
  ];
  for (const f of fixtures) {
    const r = unifyDealReadiness(f.args);
    assert.notEqual(
      r.next_action.label,
      "Resolve Blockers",
      `Generic label leaked into ${f.name} fixture`,
    );
  }
});
