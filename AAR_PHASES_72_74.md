# Phases 72–74 — Workflow Registry, Approval Governance, Output Contracts, Operator Console ✅ COMPLETE

**Closed:** April 13, 2026
**Verified on main:** All 20 files confirmed present via GitHub API file inspection.

---

## What shipped

### PR 1 — Workflow Registry (72A)
| File | Size | Notes |
|---|---|---|
| `src/lib/agentWorkflows/registry.ts` | 6,012 bytes | Pure data, `Object.freeze`, 6 workflow entries, `requiresCanonicalState` field |
| `src/lib/agentWorkflows/types.ts` | 588 bytes | `AgentWorkflowRun` type for the VIEW |
| `src/lib/agentWorkflows/index.ts` | 260 bytes | Barrel export |

**6 workflows declared:**
- `research_bundle_generation` → `buddy_research_missions`
- `document_extraction` → `deal_extraction_runs`
- `cross_doc_reconciliation` → `deal_reconciliation_results`
- `canonical_action_execution` → `canonical_action_executions`
- `borrower_request_campaign` → `borrower_request_campaigns`
- `borrower_draft_request` → `draft_borrower_requests`

**Key design decisions:**
- Registry is `Object.freeze` + `satisfies Record<string, WorkflowDefinition>` — TypeScript rejects typos, runtime rejects mutation
- `requiresCanonicalState: boolean` field enables the registry guard to verify canonical state is loaded before workflows that need it
- Zero imports from execution code — registry is pure documentation data

### PR 2 — Approval Governance (73)
| File | Notes |
|---|---|
| `supabase/migrations/20260413_phase_73_approval_snapshots.sql` | `approved_snapshot` + `sent_snapshot` columns on `draft_borrower_requests` |
| `supabase/migrations/20260413_phase_73_agent_approval_events.sql` | Immutable approval log (SR 11-7) |
| `src/lib/agentWorkflows/approval.ts` | `recordApprovalEvent()`, `verifyApprovalExists()` (revocation-aware), `buildDraftApprovalSnapshot()` |

**Approval gate design:**
- `verifyApprovalExists()` checks for approved event AND checks no subsequent revocation — revocation-aware
- `buildDraftApprovalSnapshot()` captures exact draft content at approval time — immutable record of what was approved
- No outbound borrower communication path bypasses this gate
- `agent_approval_events` table is append-only (no UPDATE/DELETE in policy)

### PR 3 — Output Contracts (74)
| File | Notes |
|---|---|
| `src/lib/agentWorkflows/contracts/researchNarrative.contract.ts` | Zod v4, tiered validation |
| `src/lib/agentWorkflows/contracts/borrowerDraft.contract.ts` | |
| `src/lib/agentWorkflows/contracts/extractionOutput.contract.ts` | |
| `src/lib/agentWorkflows/contracts/memoSection.contract.ts` | |
| `src/lib/agentWorkflows/contracts/index.ts` | Barrel export |

**Tiered validation design:**
- `WARN` severity: content length, source count guidance
- `ERROR` severity: required fields, structure
- `FATAL` severity: schema mismatches that must block persistence
- Failed contracts route to override/completion path, not hard errors

### PR 4 — Operator Console (72B)
| File | Notes |
|---|---|
| `supabase/migrations/20260413_phase_72b_agent_workflow_runs_view.sql` | Postgres VIEW unifying 6 tables |
| `src/app/api/ops/agent-runs/route.ts` | `GET /api/ops/agent-runs`, super_admin only, fail-safe |
| `src/app/(admin)/ops/agents/page.tsx` | Glass UI with filters, status badges, deal links |

**VIEW design:**
- UNION ALL across all 6 source tables
- Normalized columns: `workflow_code`, `run_id`, `deal_id`, `bank_id`, `status`, `cost_usd`, `input_tokens`, `output_tokens`, `started_at`, `completed_at`
- Route returns paginated results with optional `workflow_code` and `deal_id` filters
- Fail-safe: returns `{ ok: true, runs: [] }` on any DB error rather than 500

### PR 5 — Cost Column Promotion (72C)
| File | Notes |
|---|---|
| `supabase/migrations/20260413_phase_72c_promote_cost_columns.sql` | Adds `cost_usd`, `input_tokens`, `output_tokens`, `model_used` to `deal_extraction_runs` and `buddy_research_missions` + backfill + VIEW update |
| `src/lib/extraction/runRecord.ts` (modified) | `finalizeExtractionRun()` now writes promoted cost columns alongside `metrics` JSONB |

### PR 6 — Guards (75)
| File | Tests | Notes |
|---|---|---|
| `registryGuard.test.ts` | 18 | Purity (no execution imports), immutability, completeness checks |
| `approvalGuard.test.ts` | 12 | Structure, migration existence, send-path canary |
| `contractGuard.test.ts` | 32 | Zod v4 parsing, purity, tiered severity, runtime validation |
| `canonicalStateGuard.test.ts` | 10 | Anchoring to canonical state adapter, flags |

**Total: 72 guard tests, all passing.**

---

## Verification
- **`tsc --noEmit`:** clean (0 errors)
- **Guard tests:** 72/72 pass
- **All contracts validated against Zod v4 runtime**
- **All 20 files confirmed present on `main` via GitHub API**

---

## Key architectural decisions made during implementation

**Registry is `satisfies` not `as const`**
Using `satisfies Record<string, WorkflowDefinition>` gives TypeScript structural checking while preserving the literal types needed for status value arrays. Pure `as const` without `satisfies` would lose the structural guarantee.

**Approval revocation check uses timestamp ordering**
`verifyApprovalExists()` fetches the most recent `approved` event, then checks if any `revoked` event has a later timestamp. This handles the case where a draft is approved, revoked, then re-approved — the last approval wins.

**Operator console VIEW is read-only**
The Postgres VIEW uses `SELECT` only — no triggers, no materialization. The operator console can never accidentally modify run records.

**Cost backfill is NULL-safe**
The migration backfills `cost_usd` from existing `metrics->>'cost_usd'` JSONB for any historical records that have it. Records without cost data remain NULL rather than defaulting to 0.

---

## What this phase enables

**OCC SR 11-7 auditability:** An examiner can now open the registry and see every workflow Buddy runs, what table it persists to, whether it requires canonical state, and what its status lifecycle is — without reading TypeScript implementation code.

**Approval audit trail:** Every outbound borrower communication has an immutable `agent_approval_events` record capturing who approved it, when, and the exact content of what was approved. Revocation is also recorded. This is the documentary evidence required under SR 11-7 for AI-driven customer communications.

**Output contract enforcement:** Research narratives, memo sections, extraction outputs, and borrower drafts now have declared Zod schemas. Future persistence code can call `validateResearchNarrative(output)` before writing and handle tiered failures appropriately.

**Cost visibility:** Extraction and research run costs are now promoted to queryable columns rather than buried in JSONB. The operator console can show cost by workflow, deal, bank, and date range.

---

## Next priorities

1. **Phase 71 implementation** — Agent identity files (SOUL.md/SKILL.md), extraction evolution loop, outbox drain. Spec is in `PHASE_71_SPEC.md`.
2. **Wire output contracts to call sites** — Currently the contracts exist but aren't called at persistence points in `runMission.ts` and `buildCanonicalCreditMemo.ts`. A follow-up PR should add the validation calls.
3. **Operator console UI completion** — The route and page exist; run detail view (`/ops/agents/runs/[runId]`) is not yet built.
4. **Phase 73 workflows** — `missing_items_followup_generation` and `borrower_request_drafting` declared in registry but not yet implemented as execution paths.
5. **P0 fix** — `actions/route.ts` approve/decline still writes `stage: "approved"/"declined"` which are invalid `LifecycleStage` values. Needs fix before any live deal reaches committee.

---

## Build rules added this phase

- `WORKFLOW_REGISTRY` is the single source of truth for all agent workflows — no workflow may run without a registry entry
- `verifyApprovalExists()` must be called before any outbound borrower communication — this is enforced by the approval guard test's send-path canary
- Output contracts use tiered severity — `FATAL` blocks persistence, `ERROR` routes to override, `WARN` is advisory
- Cost columns are promoted (queryable) not buried — `cost_usd`, `input_tokens`, `output_tokens` always go to dedicated columns, never only to JSONB
