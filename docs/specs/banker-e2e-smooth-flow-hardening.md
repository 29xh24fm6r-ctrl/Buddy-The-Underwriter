# Banker E2E Smooth Flow Hardening

**Status:** Draft spec — implementation pending
**Predecessors:** PR #393 (worker hardening), PR #394 (banker E2E pipeline wiring)
**Owner area:** `src/lib/underwriting/`, `src/app/api/deals/[dealId]/`, `src/components/deals/`

---

## Goal

Make the banker analysis flow fully intuitive, deterministic, and self-healing
from deal intake through committee readiness.

A banker should always know:

- what Buddy is doing
- what is complete
- what is blocked
- exactly what to do next

No hidden states. No silent failures. No SQL required to understand deal status.

---

## UX Goal

For any deal, the UI must show:

1. Current phase (single, deterministic)
2. Checklist of completed stages
3. Clear blockers (if any)
4. Exactly ONE primary action
5. Last successful analysis (if exists)

---

## System Contract

### Source of Truth

All UI MUST derive from:

```
GET /api/deals/[dealId]/analysis-status
```

UI must NOT inspect raw tables.

---

## Phase Model (STRICT ORDER)

Phases MUST be derived in this exact priority order.
First match wins. No branching.

```
1. tenant_mismatch        → analysis_failed
2. running_analysis       → active risk_runs.status='running'
3. waiting_for_loan_request
4. waiting_for_documents
5. waiting_for_spreads
6. analysis_failed        → latest run failed
7. review_reconciliation  → FLAGS / CONFLICTS
8. ready_for_committee
9. not_started
```

---

## Primary Action (SINGLE, REQUIRED)

There must always be EXACTLY ONE `primaryAction`.

Selection rules:

```
IF blocking error exists:
    → action resolves blocker

ELSE IF canRunAnalysis:
    → "Run analysis"

ELSE IF review_reconciliation:
    → "Review reconciliation"

ELSE IF ready_for_committee:
    → "View credit memo"

ELSE:
    → disabled action with explanation
```

---

## Severity Contract

```
error:
  - blocks pipeline execution
  - blocks committee readiness

warning:
  - allows execution
  - blocks committee readiness

info:
  - does not block anything
```

---

## Success Definition (STRICT)

Pipeline is SUCCESSFUL ONLY IF:

- `deal_model_snapshots` written
- `risk_runs` completed
- `ai_risk_runs` completed
- `memo_runs` completed
- `memo_sections` exist (non-empty)
- `deal_decisions` written
- `deal_credit_memo_status` written (if CLEAN)

If ANY of the above fail:

→ phase = `analysis_failed`
→ include explicit blocker

---

## Canonical Status Object

```ts
{
  dealId,
  bankId,

  phase,

  blockers: [
    {
      code,
      severity,
      title,
      message,
      actionLabel,
      actionHref?,
      sourceTable?,
      sourceId?
    }
  ],

  completed: {
    loanRequest,
    documents,
    spreads,
    modelSnapshot,
    riskRun,
    memo,
    decision,
    committeeReady
  },

  latest: {
    riskRunId,
    aiRiskRunId,
    memoRunId,
    decisionId,
    snapshotId,
    reconciliationStatus,
    updatedAt
  },

  latestSuccessful: {
    riskRunId,
    memoRunId,
    decisionId,
    completedAt
  },

  canRunAnalysis,
  canForceReplay,

  primaryAction: {
    label,
    href?,
    method?,
    disabledReason?
  }
}
```

**Source tables** (read-only — no new tables):
`deals`, `deal_loan_requests`, `deal_documents`, `deal_spreads`,
`deal_model_snapshots`, `risk_runs`, `ai_risk_runs`, `memo_runs`,
`memo_sections`, `deal_decisions`, `deal_credit_memo_status`,
`deal_reconciliation_results`.

---

## Blockers (Standardized)

### Loan Request

```
code: LOAN_REQUEST_INCOMPLETE
severity: error
title: Loan request is incomplete
message: Buddy needs a requested loan amount before it can run analysis.
actionLabel: Complete loan request
```

---

### Spreads

```
SPREADS_NOT_STARTED
SPREADS_RUNNING
SPREADS_FAILED
SPREADS_NOT_READY
```

Each must include the latest `deal_spread_jobs` / `deal_spreads` identifier in
`sourceId` so the UI can deep-link.

---

### AI Failures

```
RISK_RUN_FAILED
MEMO_RUN_FAILED
```

- store sanitized error on `risk_runs.error` / `memo_runs.error`
- expose in status with `severity='error'`
- action: **Retry analysis** → `POST /api/deals/[dealId]/banker-analysis/run`
  with `forceRun=true` (admin / banker replay path only)

---

### Write Failures (NEW — REQUIRED)

These MUST convert to hard failures:

```
MEMO_SECTION_WRITE_FAILED
DECISION_WRITE_FAILED
COMMITTEE_READY_WRITE_FAILED
```

Pipeline MUST NOT return `status='succeeded'` if these occur.

| Failure | Action |
|---|---|
| `memo_sections` insert fails | Mark `memo_runs.status='failed'`. Return `MEMO_SECTION_WRITE_FAILED`. |
| `deal_decisions` insert fails | Return `DECISION_WRITE_FAILED`. |
| `deal_credit_memo_status` upsert fails (CLEAN + non-tabled path) | Return `COMMITTEE_READY_WRITE_FAILED`. |

---

### Reconciliation

```
FLAGS     → warning
CONFLICTS → error
```

Phase:

```
review_reconciliation
```

Message:

> "Analysis complete, but reconciliation requires review before committee."

Primary action: **"Review reconciliation"** — link to the reconciliation review
page if it exists. Phase must be `review_reconciliation`, NOT `analysis_failed`
— snapshot / risk / memo / decision were all written successfully.

---

### Stale Run Recovery

```
STALE_RUN_RECOVERED
severity: warning
message: A previous analysis run was interrupted and has been reset.
```

---

## Stale Run Cleanup

Create:

```
src/lib/underwriting/cleanupStaleAnalysisRuns.ts
```

Rules:

```
status      = 'running'
model_name  = 'banker_analysis_pipeline'
created_at  < now() - interval '10 minutes'
```

→ mark `status = 'failed'`, `error = 'stale_running_timeout'`
→ emit `deal_events.kind = 'banker_analysis.stale_run_recovered'`
→ surface `STALE_RUN_RECOVERED` blocker

Must run:

- before pipeline start (inline in `runBankerAnalysisPipeline`)
- optionally via maintenance job (do NOT add a new cron unless required)

---

## Replay Rules

Force replay allowed ONLY IF:

```
- no active running run
- OR last run failed
- OR stale run recovered
```

Replay MUST NOT bypass:

- tenant checks
- loan request
- spreads readiness

---

## UI Component

Create / update:

```
src/components/deals/DealAnalysisStatusCard.tsx
```

Must display:

- current `phase` (human-readable)
- checklist of completed stages (loan request → docs → spreads → snapshot →
  risk → memo → decision → committee-ready)
- blockers
- the single `primaryAction`
- last successful analysis (when it exists)

Must NOT reference backend tables directly.

---

## Tests (Required)

Add tests for:

- each phase resolution (priority order)
- exactly one primary action
- success definition enforcement
- `memo_sections` failure blocks success
- `deal_decisions` failure blocks success
- stale run cleanup (rows older than 10 min marked failed with
  `error='stale_running_timeout'`)
- replay constraints
- reconciliation states (`FLAGS` / `CONFLICTS`)
- API tenant enforcement (401/404 for tenant-mismatched callers)
- UI card renders the right primary action for each main blocker

---

## Runbook Updates

Update [`docs/runbooks/banker-e2e-analysis-v2.md`](../runbooks/banker-e2e-analysis-v2.md):

- Document `GET /api/deals/[dealId]/analysis-status`
- Phase definitions (one paragraph each)
- Blocker meanings
- Retry behavior
- Stale-run recovery (inline + manual SQL fallback)
- Expected UX flow walkthrough

---

## Non-Goals

Do NOT:

- change the worker system
- modify RLS
- add new core tables
- rewrite pipeline logic
- alter borrower-facing flow
- change committee decision / finalization ownership
- mutate `lifecycle_stage` from this pipeline

---

## Acceptance Criteria

- Banker can understand any deal state instantly
- Exactly one next action is always visible
- No silent partial success
- No stale runs block execution
- Reconciliation is clearly differentiated from failure
- No SQL required to debug deal state
- `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass

---

## Deliverable

One PR titled:

```
fix(analysis): harden banker E2E flow status and recovery
```
