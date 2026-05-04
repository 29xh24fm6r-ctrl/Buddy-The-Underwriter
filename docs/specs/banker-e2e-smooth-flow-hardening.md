# Banker E2E Smooth Flow Hardening

**Status:** Draft spec — implementation pending
**Predecessors:** PR #393 (worker hardening), PR #394 (banker E2E pipeline wiring)
**Owner area:** `src/lib/underwriting/`, `src/app/api/deals/[dealId]/`, `src/components/deals/`

---

## Goal

Make Buddy's banker analysis flow **intuitive, self-healing, and operationally
safe** from deal intake through spreads, risk, memo, decision, and
committee-ready state.

## User experience goal

A banker should be able to open any deal and immediately understand:

1. What Buddy is doing
2. What is complete
3. What is blocked
4. Exactly what action is needed next
5. Whether the deal is ready for committee

**No hidden states. No silent failures. No SQL/debug knowledge required.**

## Current state

- **PR #393** stabilized cron workers (advisory locks, idle probes, batch caps,
  schema fix, observability JSON).
- **PR #394** wired the authoritative banker E2E analysis pipeline — model
  snapshot → reconciliation → risk → memo → decision → committee-ready —
  awaited end-to-end after spreads succeed (no fire-and-forget).

## Remaining weaknesses to harden

| # | Weakness |
|---|---|
| 1 | Loan request blocker may be confusing or too strict. |
| 2 | Spreads readiness blocker may not explain what's missing. |
| 3 | AI risk/memo failures are handled but lack a retry/replay UX. |
| 4 | Reconciliation FLAGS/CONFLICTS look like generic failures rather than "review needed". |
| 5 | `memo_sections` insert is currently non-fatal — can leave a memo with no sections. |
| 6 | `deal_decisions` insert is currently non-fatal — can produce a "successful" run with no decision. |
| 7 | Stale `risk_runs.status='running'` rows can block future runs until the 60s window passes. |
| 8 | Deal UI needs one clear "analysis status" object instead of users needing to inspect many tables. |

---

## Implementation requirements

### 1. Canonical deal analysis status helper

Add `src/lib/underwriting/getDealAnalysisStatus.ts`. Returns a single
canonical object so the UI never has to JOIN across analysis tables itself:

```ts
export type DealAnalysisStatus = {
  dealId: string;
  bankId: string;
  phase:
    | "not_started"
    | "waiting_for_loan_request"
    | "waiting_for_documents"
    | "waiting_for_spreads"
    | "running_analysis"
    | "review_reconciliation"
    | "ready_for_committee"
    | "analysis_failed";
  blockers: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    title: string;
    message: string;
    actionLabel: string;
    actionHref?: string;
    sourceTable?: string;
    sourceId?: string;
  }>;
  completed: {
    loanRequest: boolean;
    documents: boolean;
    spreads: boolean;
    modelSnapshot: boolean;
    riskRun: boolean;
    memo: boolean;
    decision: boolean;
    committeeReady: boolean;
  };
  latest: {
    riskRunId: string | null;
    aiRiskRunId: string | null;
    memoRunId: string | null;
    decisionId: string | null;
    snapshotId: string | null;
    reconciliationStatus: "CLEAN" | "FLAGS" | "CONFLICTS" | null;
    updatedAt: string | null;
  };
  canRunAnalysis: boolean;
  canForceReplay: boolean;
  primaryAction: {
    label: string;
    href?: string;
    method?: "GET" | "POST";
    disabledReason?: string;
  };
};
```

**Source tables** (read-only — no new tables):
`deals`, `deal_loan_requests`, `deal_documents`, `deal_spreads`,
`deal_model_snapshots`, `risk_runs`, `ai_risk_runs`, `memo_runs`,
`memo_sections`, `deal_decisions`, `deal_credit_memo_status`,
`deal_reconciliation_results`.

### 2. Status API route

Add `GET /api/deals/[dealId]/analysis-status`:

- Tenant access enforced via `ensureDealBankAccess`.
- Calls `getDealAnalysisStatus`.
- Returns the canonical object.
- Never exposes raw stack traces. Sanitized errors only.

### 3. Make pipeline writes atomic — no partial "success"

In `src/lib/underwriting/runBankerAnalysisPipeline.ts`, promote these from
non-fatal warnings to real blockers / failures:

- `memo_sections` insert failure
- `deal_decisions` insert failure
- `deal_credit_memo_status` upsert failure (when CLEAN + non-tabled)

**Required behavior:**

| Failure | Action |
|---|---|
| `memo_sections` insert fails | Mark `memo_runs.status='failed'`. Return `MEMO_SECTION_WRITE_FAILED`. |
| `deal_decisions` insert fails | Return `DECISION_WRITE_FAILED`. |
| `deal_credit_memo_status` upsert fails (CLEAN + non-tabled path) | Return `COMMITTEE_READY_WRITE_FAILED`. |

**New blocker codes:**

```text
MEMO_SECTION_WRITE_FAILED
DECISION_WRITE_FAILED
COMMITTEE_READY_WRITE_FAILED
```

The pipeline must **not** return `status='succeeded'` when any of these
writes failed.

### 4. Stale running-run cleanup

Add `src/lib/underwriting/cleanupStaleAnalysisRuns.ts`:

```ts
// Find risk_runs where:
//   status = 'running'
//   model_name = 'banker_analysis_pipeline'
//   created_at < now() - interval '10 minutes'
// Mark failed:
//   status = 'failed'
//   error  = 'stale_running_timeout'
// Emit deal event:
//   kind = 'banker_analysis.stale_run_recovered'
```

Call sites:

- At the start of `runBankerAnalysisPipeline` for that deal (so a new run
  isn't blocked by a 30-min-old `running` row).
- Optionally from a low-frequency maintenance route. Do **not** add a new
  cron unless absolutely necessary — call it inline at run-start to keep
  the operational footprint small.

### 5. Loan request blocker UX

When loan amount is missing:

```text
code:        LOAN_REQUEST_INCOMPLETE
title:       "Loan request is incomplete"
message:     "Buddy needs a requested loan amount before it can prepare the analysis."
actionLabel: "Complete loan request"
```

Link to the existing loan-request edit page if one exists; otherwise leave
`actionHref` null.

### 6. Spreads blocker UX — distinguish states

Replace the single `SPREADS_NOT_READY` blocker with the right one of:

| Code | Meaning |
|---|---|
| `SPREADS_NOT_STARTED` | No `deal_spreads` row at all. |
| `SPREADS_RUNNING` | Spread job in progress. |
| `SPREADS_FAILED` | Latest spread row in error state. |
| `SPREADS_NOT_READY` | Row exists but `status` is neither `ready` nor a known transient. |

Each blocker should embed the latest `deal_spread_jobs` / `deal_spreads`
identifier in `sourceId` so the UI can deep-link.

### 7. AI provider failure UX — retry/replay

When `RISK_RUN_FAILED` or `MEMO_RUN_FAILED`:

- Store sanitized error on `risk_runs.error` / `memo_runs.error`.
- Surface in analysis status with `severity='error'`.
- `primaryAction.label = "Retry analysis"`.
- Retry calls `POST /api/deals/[dealId]/banker-analysis/run` with
  `forceRun=true`. Only the admin / banker replay path may pass `forceRun`.

### 8. Reconciliation = review state, not failure

| Recon status | Phase | Severity |
|---|---|---|
| `FLAGS` | `review_reconciliation` | `warning` |
| `CONFLICTS` | `review_reconciliation` | `error` |

Message:
> "Buddy generated the analysis, but reconciliation needs review before committee."

Primary action: **"Review reconciliation"** — link to the reconciliation
review page if it exists.

The phase must be `review_reconciliation`, not `analysis_failed` — the
analysis tables (snapshot / risk / memo / decision) were all written
successfully.

### 9. UI: `DealAnalysisStatusCard.tsx`

Add or update `src/components/deals/DealAnalysisStatusCard.tsx`. It must
show:

- current `phase` (human-readable)
- checklist of completed stages (loan request → docs → spreads → snapshot →
  risk → memo → decision → committee-ready)
- the current blocker / action (driven by `primaryAction`)
- latest memo / risk / decision status
- a "Run analysis" or "Retry analysis" button when `canRunAnalysis` /
  `canForceReplay` is true

The card must not require users to understand backend table names.

### 10. Tests

| # | Test |
|---|---|
| 1 | Status helper returns `waiting_for_loan_request` when no LR + no `deals.loan_amount`. |
| 2 | Status helper returns `waiting_for_spreads` when LR present but no ready `deal_spreads`. |
| 3 | Status helper returns `running_analysis` when a `risk_runs.status='running'` row is current. |
| 4 | Status helper returns `review_reconciliation` for `FLAGS` and `CONFLICTS`. |
| 5 | Status helper returns `ready_for_committee` only when memo + decision + CLEAN + `deal_credit_memo_status='ready_for_committee'` all hold. |
| 6 | Pipeline does not return `succeeded` when `memo_sections` insert fails. |
| 7 | Pipeline does not return `succeeded` when `deal_decisions` insert fails. |
| 8 | `cleanupStaleAnalysisRuns` marks `running` rows older than 10 min as `failed` with `error='stale_running_timeout'`. |
| 9 | API route returns 401/404 for tenant-mismatched callers. |
| 10 | UI card renders the right primary action for each main blocker. |

### 11. Runbook update

Update [`docs/runbooks/banker-e2e-analysis-v2.md`](../runbooks/banker-e2e-analysis-v2.md):

- Document `GET /api/deals/[dealId]/analysis-status`
- Phase definitions (one paragraph each)
- Common blockers and what the banker should do
- Stale-run recovery SQL (manual fallback if the inline cleanup misses)
- Replay instructions
- Expected user-facing flow walkthrough

### 12. Out of scope (do not broaden architecture)

- No new tables unless absolutely necessary.
- No rewrite of the worker system.
- No RLS changes.
- No borrower-facing flow changes.
- No change to committee decision / finalization ownership.
- No `lifecycle_stage` mutations from this pipeline.

---

## Acceptance criteria

- A banker can open any deal and know exactly what to do next.
- Pipeline never reports `succeeded` when memo sections, decision, or
  committee-ready writes failed.
- Stale running analysis runs recover automatically (no manual SQL needed).
- Reconciliation review states are clear and not mistaken for system errors.
- No hidden failure requires SQL inspection to understand — every blocker is
  surfaced through the analysis-status object.
- `pnpm test:unit` passes.
- `pnpm typecheck` passes.
- `pnpm lint` has 0 errors.
- `pnpm build` passes.

## Deliverable

One PR titled:

```text
fix(analysis): harden banker E2E flow status and recovery
```

Implementing this spec end-to-end. Tracks the contract above, with the
required tests and the runbook update.
