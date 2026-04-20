# T-08 — Governance Writer-Existence Audit

**Date:** 2026-04-20
**Ticket:** Phase 84 T-08 (converted from smoke test to audit-only)
**Spec:** `specs/phase-84-t08-governance-audit.md`
**Authored by:** Claude Code, executing against Opus's pre-work + spec
**Status:** ⏳ IN PROGRESS — sections marked TBD pending Claude Code execution

---

## TL;DR

<TBD — fill in after completing all sections. 3-4 sentences max:
1. How many tables have a reachable writer
2. The reconciliation gate finding (currently the only blocker keeping deal_decisions empty)
3. How many Phase 84.1 tickets generated
4. Single most actionable next step>

---

## Pre-work findings (verified by Opus, cited here)

### Empty governance tables (2026-04-20 15:30 UTC)
```
agent_approval_events:        0 rows
agent_skill_evolutions:       0 rows
borrower_request_campaigns:   0 rows
canonical_action_executions:  0 rows
deal_decisions:               0 rows
draft_borrower_requests:      0 rows
```

### Reconciliation gate state across test deals
```
ChatGPT Fix 11        recon: NULL          → blocked
ChatGPT Fix 12        recon: NULL          → blocked
ChatGPT Fix 13        recon: NULL          → blocked
ChatGPT Fix 14        recon: NULL          → blocked
ChatGPT Fix 15        recon: CONFLICTS     → blocked
Ellmann Part 2 (×4)   recon: NULL          → blocked

Total: 0 of 9 test deals can pass actions/route.ts:approve gate
```

### Endpoint inventory (v2 spec assumed paths vs reality)
```
✓ FOUND   /api/deals/[dealId]/actions             (writes deal_decisions on approve/decline/escalate)
✗ MISSING /api/admin/agent-approvals
✓ FOUND   /api/deals/[dealId]/actions/execute     (writes UNVERIFIED — investigate in T-08-C)
✗ MISSING /api/deals/[dealId]/draft-borrower-request
✓ FOUND   /api/deals/[dealId]/borrower-request    (writes borrower_invites + borrower_request_packs,
                                                     NOT draft_borrower_requests — different system)
```

---

## Section 1 — Per-table writer/reader map

### `deal_decisions`

**Writers (code):**
<TBD — paste grep output verbatim from Step 1>

**Writers (RPC):**
<TBD — paste from Step 2 query results, filtered to this table>

**Readers:**
<TBD — paste grep output>

**Why empty in production:**
Writer exists in `actions/route.ts` but is gated on `deal_reconciliation_results.overall_status NOT IN (NULL, 'CONFLICTS')`. 0 deals across all banks have `CLEAN` or `FLAGS` status (verified in Section 3). The decline/escalate paths don't have the recon gate but require an authenticated banker session executing the action — which hasn't happened on any test deal yet.

**Phase reference (archaeology):**
<TBD — fill in from Step 4 grep>

---

### `agent_approval_events`

**Writers (code):**
<TBD>

**Writers (RPC):**
<TBD>

**Readers:**
<TBD>

**Why empty in production:**
<TBD — based on writer findings; if no writer, state that. If writer exists but unreachable, explain how>

**Phase reference (archaeology):**
<TBD>

---

### `canonical_action_executions`

**Writers (code):**
<TBD>

**Writers (RPC):**
<TBD>

**Readers:**
<TBD>

**Why empty in production:**
<TBD>

**Phase reference (archaeology):**
<TBD>

---

### `draft_borrower_requests`

**Writers (code):**
<TBD>

**Writers (RPC):**
<TBD>

**Readers:**
<TBD>

**Why empty in production:**
This is the AI-drafts-message → human-approves → system-sends pipeline (Phase 75 governance intent). The `borrower-request` route at `src/app/api/deals/[dealId]/borrower-request/route.ts` has the right name but writes to `borrower_invites` + `borrower_request_packs` — a different system (Phase 73 portal upload links).
<TBD — supplement with grep findings if any partial writer is discovered>

**Phase reference (archaeology):**
<TBD>

---

### `agent_skill_evolutions`

**Writers (code):**
<TBD>

**Writers (RPC):**
<TBD>

**Readers:**
<TBD>

**Why empty in production:**
<TBD — likely orphan from Phase 72/73; confirm via archaeology>

**Phase reference (archaeology):**
<TBD>

---

### `borrower_request_campaigns`

**Writers (code):**
<TBD>

**Writers (RPC):**
<TBD>

**Readers:**
<TBD>

**Why empty in production:**
<TBD — note FK dependency on canonical_action_executions.canonical_execution_id; cannot populate before T-08-C ships>

**Phase reference (archaeology):**
<TBD>

---

## Section 2 — Reconciliation gate analysis

### Distribution across all deals (test + real)
<TBD — paste full SQL output>

### Reconciliation status distribution by overall_status
<TBD — paste full SQL output>

### Headline finding
<TBD — single sentence summarizing whether ANY deal has ever produced CLEAN. If 0, this is the most actionable finding of T-08>

### What blocks reconciliation from producing CLEAN today
<TBD — investigate briefly: is reconciliation running but failing? Not running at all? Schema mismatch? Don't go deep — that's T-08-A's job. One paragraph max>

---

## Section 3 — Endpoint route inventory

<TBD — copy from pre-work findings, expand if Step 1 grep surfaces additional routes that touch governance tables>

---

## Section 4 — Phase archaeology

### Migration origin per table

| Table | Migration filename | Phase intent (from AAR) |
|---|---|---|
| deal_decisions | <TBD> | <TBD> |
| agent_approval_events | <TBD> | <TBD> |
| canonical_action_executions | <TBD> | <TBD> |
| draft_borrower_requests | <TBD> | <TBD> |
| agent_skill_evolutions | <TBD> | <TBD> |
| borrower_request_campaigns | <TBD> | <TBD> |

### Pattern observed
<TBD — one paragraph: are these all from the same phase window? Did writers ship for some and not others? Is there a discoverable reason the writers were deferred or canceled?>

---

## Section 5 — Phase 84.1 ticket stubs

### T-08-A — Run reconciliation to CLEAN on a canary deal

**Table affected:** `deal_decisions` (unblocks)

**Status discovered:** Writer exists at `src/app/api/deals/[dealId]/actions/route.ts:182`. Gated on reconciliation status. Blocker is upstream — not the writer itself.

**Findings from audit:**
- 0 deals across all banks have `deal_reconciliation_results.overall_status = 'CLEAN'`
- 1 deal has `CONFLICTS` (ChatGPT Fix 15)
- 8 deals have NULL (reconciliation never ran)
- The actions/approve handler hard-blocks both NULL and CONFLICTS with HTTP 422

**Required to make live:**
1. Identify why reconciliation hasn't run on test deals — is `reconcileDeal()` failing silently, never being called, or running but always producing CONFLICTS?
2. Pick a canary deal. Drive it to CLEAN by either (a) fixing whatever blocks reconciliation from completing, or (b) curating its inputs so reconciliation produces CLEAN naturally. Do NOT force-update the row.
3. Once CLEAN, invoke approve via authenticated banker session (real Clerk cookie). Verify `deal_decisions` row appears.

**Estimated scope:** Medium. Depends entirely on what's blocking reconciliation. Could be 1 hour (re-run a worker that's been disabled) or 2 days (schema mismatch in the recon engine that needs migration).

**Out of scope for 84.1 if:** Reconciliation is found to be intentionally disabled pending a Phase 85+ rewrite. In that case, this ticket converts to "document the disablement rationale + define new gate criteria."

**Acceptance criteria:**
- ≥ 1 row in `deal_decisions` where `decided_by` is a real Clerk userId (not synthetic)
- The row's `reconciliation_status` is non-null
- Pipeline ledger shows the originating banker session

**Phase reference:** Phase 75 governance group (recon gate added then)

---

### T-08-B — Build agent_approval_events writer

**Table affected:** `agent_approval_events`

**Status discovered:** <TBD — based on grep findings>

**Findings from audit:**
<TBD>

**Required to make live:**
<TBD>

**Estimated scope:** <TBD>

**Out of scope for 84.1 if:** Product confirms the human-in-the-loop AI approval workflow was deprecated post-Phase 75.

**Acceptance criteria:**
- ≥ 1 row in `agent_approval_events` sourced from a real human approval action triggered through a UI surface (not synthetic, not test fixture)

**Phase reference:** <TBD>

---

### T-08-C — Build canonical_action_executions writer

**Table affected:** `canonical_action_executions`

**Status discovered:** <TBD>

**Findings from audit:**
<TBD>
- Note: investigate whether `actions/execute/route.ts` (FOUND in inventory) is intended to write this table. If yes, why isn't it firing?

**Required to make live:**
<TBD>

**Estimated scope:** <TBD>

**Out of scope for 84.1 if:** <TBD>

**Acceptance criteria:**
- ≥ 1 row in `canonical_action_executions` sourced from a real canonical action execution
- `actor_type` correctly distinguishes 'human' vs 'agent' vs 'system'

**Phase reference:** <TBD>

---

### T-08-D — Build draft_borrower_requests AI-draft pipeline

**Table affected:** `draft_borrower_requests`

**Status discovered:** No writer found in repo. Schema designed for AI-drafts-message → human-approves → system-sends flow. Distinct from existing `borrower-request` route.

**Findings from audit:**
<TBD — confirm "no writer found" via grep, OR adjust if a partial writer is discovered>

**Required to make live:**
1. AI message-drafting service that produces `draft_subject` + `draft_message` + `evidence` for a missing-document scenario
2. Approve endpoint that flips `status: pending_approval` → 'approved' and freezes `approved_snapshot`
3. Send dispatcher that consumes approved drafts, sends via the chosen channel (`sent_via`), freezes `sent_snapshot`, sets `sent_at`
4. UI surface for human approver

**Estimated scope:** Multi-week feature. **This is not a 84.1 ticket** — it's a roadmapped feature that should be planned alongside Phase 85+ borrower-comms work.

**Out of scope for 84.1 if:** Always — recommend roadmapping into a future product phase, not 84.1 cleanup.

**Acceptance criteria:**
- Pipeline can move a draft through pending_approval → approved → sent
- Both snapshots persist correctly at each transition

**Phase reference:** Phase 75 governance group; never finished

---

### T-08-E — Decide: build or retire agent_skill_evolutions

**Table affected:** `agent_skill_evolutions`

**Status discovered:** <TBD — likely orphan>

**Findings from audit:**
<TBD>

**Required to make live (if "build"):**
<TBD>

**Required to retire (if "drop"):**
1. Confirm with product that the agent self-improvement loop is no longer in scope
2. Migration to `DROP TABLE public.agent_skill_evolutions`
3. Remove any remaining type definitions or readers (if any)

**Estimated scope:** Tiny if retire (1 migration). Multi-week feature if build.

**Out of scope for 84.1 if:** Product wants to defer the decision. In that case, table stays and ticket becomes "document the deferral + revisit at Phase 86."

**Acceptance criteria (build):** ≥ 1 row from a real agent-proposed skill change reaching the human approver
**Acceptance criteria (retire):** Table dropped + no orphan references in repo

**Phase reference:** Phase 72/73 holdover

---

### T-08-F — Build borrower_request_campaigns writer

**Table affected:** `borrower_request_campaigns`

**Status discovered:** Schema includes FK `canonical_execution_id` → `canonical_action_executions.id`. Cannot populate before T-08-C ships.

**Findings from audit:**
<TBD>

**Required to make live:**
1. T-08-C must ship first
2. Then: campaign-creation hook that fires when a `canonical_action_executions` row of type "borrower_request" succeeds
3. Status state machine: `pending → sending → sent → completed | failed`
4. Dispatcher integration with email/SMS providers

**Estimated scope:** Medium-large. Depends on T-08-C scope.

**Out of scope for 84.1 if:** T-08-C is deferred or canceled.

**Acceptance criteria:**
- ≥ 1 row in `borrower_request_campaigns` linked back to a `canonical_action_executions` row via `canonical_execution_id`
- Status field correctly transitions on send

**Phase reference:** Phase 76 borrower outreach group; never finished

---

## Section 6 — Meta-finding: Wave 3 governance is structurally incomplete

<TBD — one paragraph synthesis. Phases 72–77 added governance schemas and adapter layers (OmegaAdvisoryAdapter, BuddyCanonicalStateAdapter, etc.) but the actual write paths for governance events were never finished. The empty governance tables are the visible symptom. Phase 84.1 should consider whether to (a) finish each writer individually as separate tickets, (b) deprecate orphan schemas, or (c) consolidate the governance layer into a single coherent design before further build.>

---

## Acceptance criterion (T-08 audit ticket itself)

The original v2 spec criterion was "≥ 1 row in each governance table." That criterion was based on a wrong premise (writers exist, just need a smoke). The new acceptance criterion is:

**For each governance table, this audit identifies (a) whether a writer exists in the repo, (b) whether the writer is reachable in production, (c) what specifically blocks population, and (d) the Phase 84.1 work needed to make it live. Tables remain empty by truth, not empty waiting to be faked.**

Tables remain empty after T-08 closes. That's the correct state.

---

## Tickets to add to Phase 84.1 backlog (committed via this audit)

1. T-08-A — Run reconciliation to CLEAN on canary deal (highest leverage; unblocks deal_decisions naturally)
2. T-08-B — Build agent_approval_events writer (or confirm deprecated)
3. T-08-C — Build canonical_action_executions writer
4. T-08-D — Roadmap draft_borrower_requests AI-draft pipeline (NOT 84.1 — multi-week feature)
5. T-08-E — Decide build-vs-retire on agent_skill_evolutions
6. T-08-F — Build borrower_request_campaigns writer (downstream of T-08-C)

Plus the Wave-3-completeness meta-ticket noted in Section 6.
