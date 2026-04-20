# T-08 — Governance Writer-Existence Audit

**Date:** 2026-04-20
**Ticket:** Phase 84 T-08 (converted from smoke test to audit-only)
**Spec:** `specs/phase-84-t08-governance-audit.md`
**Authored by:** Claude Code, executing against Opus's pre-work + spec
**Status:** ✅ COMPLETE

---

## TL;DR

Of 6 governance tables, **1 has a writer blocked by reconciliation gate** (deal_decisions), **2 have writers that are live but never invoked / starved of input** (canonical_action_executions, agent_skill_evolutions), and **3 have no writer anywhere in the repo** (agent_approval_events, draft_borrower_requests, borrower_request_campaigns). The audit surfaced a headline finding beyond the per-table map: **every deal in the DB (9/9) is flagged `is_test = true`** — zero non-test production activity. That recontextualizes every "empty table" finding as "infrastructure waiting for a real customer," not broken. **7 Phase 84.1 tickets generated, with T-08-G (production-activity baseline) as the gating priority.**

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
✓ FOUND   /api/deals/[dealId]/actions/execute     (calls executeCanonicalAction → writes canonical_action_executions)
✗ MISSING /api/deals/[dealId]/draft-borrower-request
✓ FOUND   /api/deals/[dealId]/borrower-request    (writes borrower_invites + borrower_request_packs,
                                                     NOT draft_borrower_requests — different system)
```

---

## Section 1 — Per-table writer/reader map

### `deal_decisions`

**Writers (code):**
```
src/app/api/deals/[dealId]/actions/route.ts:160:        await sb.from("deal_decisions").insert({
src/app/api/deals/[dealId]/actions/route.ts:174:        await sb.from("deal_decisions").insert({
src/app/api/deals/[dealId]/actions/route.ts:185:        await sb.from("deal_decisions").insert({
```

**Writers (RPC):** none

**Readers:** none (grep returned no hits)

**Why empty in production:**
Writer exists in `actions/route.ts` at 3 insertion sites (approve/decline/escalate paths). The `approve` path is gated on `deal_reconciliation_results.overall_status NOT IN (NULL, 'CONFLICTS')`. 0 deals across all banks have `CLEAN` or `FLAGS` status (verified in Section 2). The decline/escalate paths don't have the recon gate but require an authenticated banker session executing the action — which hasn't happened on any test deal.

**Phase reference (archaeology):** Phase 75 (migration `20260413_phase_75_deal_decisions.sql`). Recon gate added in same phase.

---

### `agent_approval_events`

**Writers (code):** **NONE found** (grep returned empty)

**Writers (RPC):** none

**Readers:** none (grep returned no hits)

**Why empty in production:**
No writer exists in the repo. Schema designed for human-in-the-loop approval logging (polymorphic `entity_type` + `entity_id`), but no code path ever calls an `.insert()` on this table. Unfinished Phase 73 work.

**Phase reference (archaeology):** Phase 73 (migration `20260413_phase_73_agent_approval_events.sql`). Schema landed but writer was deferred and never shipped.

---

### `canonical_action_executions`

**Writers (code):**
```
src/core/actions/execution/executeCanonicalAction.ts:31:    await sb.from("canonical_action_executions").insert({  (success path)
src/core/actions/execution/executeCanonicalAction.ts:63:      await sb.from("canonical_action_executions").insert({  (failure path)
```

**Writers (RPC):** none

**Readers:** none (grep returned no hits)

**Why empty in production:**
**Writer exists and is fully wired** — not a missing writer as pre-work assumed. Upstream route at [src/app/api/deals/[dealId]/actions/execute/route.ts:70](src/app/api/deals/[dealId]/actions/execute/route.ts#L70) calls `executeCanonicalAction()` after authenticating via `ensureDealBankAccess()` + validating that the requested `actionCode` appears in `deriveNextActions()`'s output for the deal.

Empty because **no banker has ever invoked POST /api/deals/[dealId]/actions/execute against any deal where `deriveNextActions()` returned a valid actionCode**. Open questions tracked in T-08-C.

**Phase reference (archaeology):** Phase 65E (migration `20260328_canonical_action_executions.sql`). Writer landed in same phase.

---

### `draft_borrower_requests`

**Writers (code):** **NONE found**

**Writers (RPC):** none

**Readers:** none (grep returned no hits)

**Why empty in production:**
This is the AI-drafts-message → human-approves → system-sends pipeline (Phase 75 governance intent). The `borrower-request` route at `src/app/api/deals/[dealId]/borrower-request/route.ts` has the right name but writes to `borrower_invites` + `borrower_request_packs` — a different system (Phase 73 portal upload links).

No code path references `draft_borrower_requests` table by name as a writer. Feature never built.

**Phase reference (archaeology):** Schema predates Phase 64 (migration `20251218000003_draft_borrower_requests.sql`, dated Dec 18 2025). Writer was intended to ship with Phase 75 governance work; never shipped.

---

### `agent_skill_evolutions`

**Writers (code):**
```
src/lib/learningLoop/evolutionStager.ts:79:    await sb.from("agent_skill_evolutions").insert({
```

**Writers (RPC):** none

**Readers:** none (grep returned no hits)

**Why empty in production:**
**Writer exists and is wired** — not an orphan as pre-work assumed. Called fire-and-forget from `correctionLogger.ts:52` inside `logCorrection()`. The stager gates on `extraction_correction_log` having ≥3 rows for the same `(document_type, fact_key)` combo with error rate > 5%.

**Starved of input:** `extraction_correction_log` has **0 rows**. The upstream `logCorrection()` function exists but is not called by any production code path. The writer is healthy; the pipeline that feeds it was never wired.

**Phase reference (archaeology):** Phase 71b (migration `20260413_phase_71b_agent_skill_evolutions.sql`). Writer + stager shipped in same phase; upstream `logCorrection()` caller never wired.

---

### `borrower_request_campaigns`

**Writers (code):** **NONE found**

**Writers (RPC):** none

**Readers:** none (grep returned no hits)

**Why empty in production:**
Schema includes FK `canonical_execution_id → canonical_action_executions.id`. Cannot populate before `canonical_action_executions` sees its first row (see T-08-C). No campaign-creation hook exists — likely intended to fire when a `canonical_action_executions` row of type "borrower_request" succeeds, but that hook was never built.

**Phase reference (archaeology):** Post-close monitoring group (migration `20260511_post_close_monitoring.sql`). Schema only; writer never shipped.

---

## Section 2 — Reconciliation gate analysis

### Distribution across all deals (test + real)
```
is_test | total_deals | never_run | clean | flags | conflicts
true    |      9      |     8     |   0   |   0   |     1
```

**All 9 deals are `is_test = true`.** Zero non-test deals exist in the entire database. See T-08-G for the downstream implications.

### Reconciliation status distribution by overall_status
```
overall_status   cnt   earliest                       latest
CONFLICTS         2    2026-04-03 23:45:36.844755+00  2026-04-14 19:00:14.754677+00
```

### Headline finding
**Only 2 reconciliation runs have ever completed across the entire DB lifetime (2026-04-03 and 2026-04-14), both CONFLICTS. Zero CLEAN or FLAGS ever produced. 7 of 9 deals never triggered reconciliation at all.** The gate has never been passable for any deal, ever.

### What blocks reconciliation from producing CLEAN today
Two questions compound, neither answered in this audit (investigation is T-08-A):
1. **Why does `reconcileDeal()` fire so rarely?** 2 runs in 17+ days suggests it's guarded by a condition rarely met, or is invoked manually rather than automatically, or a scheduled job isn't running.
2. **Why are both existing runs CONFLICTS?** Could be a correct verdict (the test data genuinely has inconsistencies) OR a false-positive bug in the reconciliation engine itself. Investigation required.

---

## Section 3 — Endpoint route inventory

| Route | Exists? | Writes governance table? |
|---|---|---|
| `POST /api/deals/[dealId]/actions` | ✓ FOUND | `deal_decisions` (approve/decline/escalate) |
| `POST /api/admin/agent-approvals` | ✗ MISSING | would-be writer of `agent_approval_events` |
| `POST /api/deals/[dealId]/actions/execute` | ✓ FOUND | `canonical_action_executions` (via `executeCanonicalAction()`) |
| `POST /api/deals/[dealId]/draft-borrower-request` | ✗ MISSING | would-be writer of `draft_borrower_requests` |
| `POST /api/deals/[dealId]/borrower-request` | ✓ FOUND (but wrong target) | `borrower_invites` + `borrower_request_packs` — Phase 73 portal upload links, NOT draft_borrower_requests |

No additional routes touching any of the 6 governance tables were discovered in the grep.

---

## Section 4 — Phase archaeology

### Migration origin per table

| Table | Migration filename | Phase intent |
|---|---|---|
| `deal_decisions` | `20260413_phase_75_deal_decisions.sql` | Phase 75 governance group — schema + writer shipped |
| `agent_approval_events` | `20260413_phase_73_agent_approval_events.sql` | Phase 73 — schema shipped, writer never built |
| `canonical_action_executions` | `20260328_canonical_action_executions.sql` | Phase 65E — schema + writer + route all shipped |
| `draft_borrower_requests` | `20251218000003_draft_borrower_requests.sql` | Pre-Phase-64 (Dec 2025) — schema only, writer never built |
| `agent_skill_evolutions` | `20260413_phase_71b_agent_skill_evolutions.sql` | Phase 71b — schema + writer + stager shipped; upstream `logCorrection()` caller never wired |
| `borrower_request_campaigns` | `20260511_post_close_monitoring.sql` | Post-close monitoring group — schema only, writer never built |

### Pattern observed

Three distinct patterns across the 6 tables:

1. **Complete + gated** (1 table): `deal_decisions`. Schema, writer, and route all shipped. Blocked only by the reconciliation precondition.
2. **Complete but starved / never triggered** (2 tables): `canonical_action_executions`, `agent_skill_evolutions`. Both have schema + writer + immediate callers shipped. Both empty because the *upstream trigger* (banker clicking Execute Action; analyst logging a correction) never fires. Indicates either unfinished UI surfaces or product-flow gaps, not backend bugs.
3. **Schema only** (3 tables): `agent_approval_events`, `draft_borrower_requests`, `borrower_request_campaigns`. Schemas landed 4–6 months before the governance ticket execution window; writers were scoped for later phases and never shipped.

**The governance layer was built bottom-up (schemas first, then writers, then callers) and stalled in the middle.** Six schemas + three writers + zero reachable callers. The v2 spec's "infrastructure shipped but never exercised" framing was directionally right but under-specified which layer the infrastructure actually reaches.

---

## Section 5 — Phase 84.1 ticket stubs

### T-08-G — Production activity baseline (gating ticket)

**Table affected:** none directly — **this is a meta-ticket that gates priority of all other T-08-* tickets**

**Status discovered:** 0 non-test deals in the database. After T-06 flagged the Ellmann cluster + 5 ChatGPT Fix deals as test, all 9 deals carry `is_test = true`.

**Findings from audit:**
- `SELECT COUNT(*) FROM deals WHERE is_test = false` → 0
- Every "empty table" finding in Phase 84 (governance tables, ai_risk_runs sparsity, deal_extraction_runs before T-04, reconciliation-result scarcity) is consistent with a database that has no real production activity, not a database with broken infrastructure
- 2 reconciliation runs in 17+ days on 9 test deals = ~1 run per 150 test-deal-days, which is essentially dev-only cadence

**Required to clarify:**
1. Does any bank tenant currently have a non-test deal in flight?
2. If no, is there a planned go-live date that should reshape Phase 84.1 priorities?
3. If yes, why aren't real deals showing up in queries — RLS scoping bug? Different DB? Wrong query? Something T-01's RLS migration didn't handle?

**Estimated scope:** 30 minutes of organizational digging, not engineering work.

**Out of scope for 84.1 if:** Answer changes but the priority implications don't — e.g., if there's a go-live scheduled for Phase 85 and we're sizing 84.1 against the gap.

**Acceptance criteria:**
- Documented answer to question 1 captured in Phase 84.1 backlog
- Documented priority reordering of T-08-A through T-08-F based on the answer

**Phase reference:** N/A — meta-finding from this audit

---

### T-08-A — Investigate reconciliation rarity + CONFLICTS-bias

**Table affected:** `deal_decisions` (unblocks on approve path)

**Status discovered:** Writer exists at `src/app/api/deals/[dealId]/actions/route.ts:160,174,185`. Gated on reconciliation status. Blocker is upstream — not the writer itself.

**Findings from audit:**
- Only 2 reconciliation runs have ever completed across the entire DB lifetime (2026-04-03 and 2026-04-14), both CONFLICTS
- 7 of 9 deals never triggered reconciliation
- 0 deals across all banks have `deal_reconciliation_results.overall_status = 'CLEAN'` or `'FLAGS'`
- 1 deal has `CONFLICTS` (ChatGPT Fix 15)
- Actions/approve handler hard-blocks both NULL and CONFLICTS with HTTP 422

**Required to make live:**
1. Investigate why `reconcileDeal()` fires so rarely — guarded by condition rarely met? Manually triggered? Scheduled job disabled?
2. Determine whether the CONFLICTS verdict on the existing 2 runs is correct (real data inconsistencies) or a false-positive bug in the reconciliation engine
3. Only after 1 + 2: pick a canary deal, drive to CLEAN by fixing upstream inputs (NOT by force-updating the status row)
4. Once CLEAN, invoke approve via authenticated banker session (real Clerk cookie). Verify `deal_decisions` row appears

**Estimated scope:** Larger than initially scoped — investigation phase before any canary work. Could range from 2 hours (re-enable a cron that was paused) to multiple days (fix a false-positive in the reconciliation engine itself).

**Out of scope for 84.1 if:** T-08-G reveals no live banks, in which case recon-gate work becomes low-priority theater.

**Acceptance criteria:**
- Root cause of low recon run rate documented
- Root cause of 100% CONFLICTS verdict documented
- ≥ 1 row in `deal_decisions` where `decided_by` is a real Clerk userId and `reconciliation_status` is non-null

**Phase reference:** Phase 75 governance group (recon gate added then)

---

### T-08-B — Build `agent_approval_events` writer (or confirm deprecated)

**Table affected:** `agent_approval_events`

**Status discovered:** No writer found in repo. No RPC writer. No readers either. Schema-only.

**Findings from audit:**
- Zero `.insert()` calls on the table across `src/` and `supabase/migrations/`
- Zero RPC functions insert into it
- Schema designed for polymorphic human-in-the-loop approval logging (`entity_type` + `entity_id`, `decision`, `snapshot_json`)
- Spec's assumed writer path `/api/admin/agent-approvals` does not exist in the repo
- Phase 73 governance group shipped schema; writer was deferred and never came back

**Required to make live:**
1. Confirm with product whether the human-in-the-loop AI approval workflow is still in scope post-Phase 75
2. If yes: build admin approve/reject route + UI surface. Polymorphic entity handling requires deciding which entities need approval (canonical actions? borrower draft messages? skill evolutions?) and writing approval logic per-entity-type
3. If no: migration to `DROP TABLE public.agent_approval_events`

**Estimated scope:** Medium-large if build (1–2 weeks). Tiny if retire (1 migration).

**Out of scope for 84.1 if:** Product wants to defer the decision. Revisit at Phase 86.

**Acceptance criteria (build):** ≥ 1 row in `agent_approval_events` sourced from a real human approval action triggered through a UI surface (not synthetic, not test fixture)

**Acceptance criteria (retire):** Table dropped + no orphan type definitions or references in repo

**Phase reference:** Phase 73 governance group

---

### T-08-C — Investigate why `executeCanonicalAction` is never invoked

**Table affected:** `canonical_action_executions`

**Status discovered:** **Writer exists and is fully wired** (Phase 65E). Called from authenticated route at `/api/deals/[dealId]/actions/execute`. Empty because the route has never been invoked against a deal with a valid `actionCode`.

**Findings from audit:**
- Writer at `src/core/actions/execution/executeCanonicalAction.ts:31,63` — both success and failure paths write the row
- Route at `src/app/api/deals/[dealId]/actions/execute/route.ts:70` — authenticated (`ensureDealBankAccess`) + validates actionCode against `deriveNextActions()` output
- 0 rows in table → 0 successful invocations across all deals

**Required to make live:**
1. Investigate whether `deriveNextActions()` returns empty for current test deals (likely — state machine may not produce any actions until prerequisites like CLEAN reconciliation are met)
2. Investigate whether the Execute Action UI surface exists — is it hidden behind a feature flag, in an unreleased UI component, only accessible via direct POST?
3. Determine which banker workflow is supposed to trigger Execute Action in practice
4. Drive at least one deal through whatever sequence is required for a banker to successfully hit the route

**Estimated scope:** Small-medium. Investigation-heavy, not build-heavy. Likely reveals either a missing UI button or a gating condition that compounds with T-08-A.

**Out of scope for 84.1 if:** T-08-G reveals no live banks, in which case this becomes lower-priority.

**Acceptance criteria:**
- Documented path from banker UI click → `POST /actions/execute` → `executeCanonicalAction()` → row in `canonical_action_executions`
- ≥ 1 row sourced from a real banker action, with `actor_type = 'banker'`

**Phase reference:** Phase 65E

---

### T-08-D — Build `draft_borrower_requests` AI-draft pipeline

**Table affected:** `draft_borrower_requests`

**Status discovered:** No writer found in repo. Schema designed for AI-drafts-message → human-approves → system-sends flow. Distinct from existing `borrower-request` route.

**Findings from audit:**
- Zero `.insert()` on the table
- Zero RPC writers
- Spec's assumed writer path `/api/deals/[dealId]/draft-borrower-request` does not exist
- The actual `borrower-request` route writes to `borrower_invites` + `borrower_request_packs` (Phase 73 portal upload links — different system)

**Required to make live:**
1. AI message-drafting service that produces `draft_subject` + `draft_message` + `evidence` for a missing-document scenario
2. Approve endpoint flips `status: pending_approval → approved` and freezes `approved_snapshot`
3. Send dispatcher consumes approved drafts, sends via chosen channel (`sent_via`), freezes `sent_snapshot`, sets `sent_at`
4. UI surface for human approver

**Estimated scope:** Multi-week feature. **This is not a 84.1 ticket** — it's a roadmapped feature that should be planned alongside Phase 85+ borrower-comms work.

**Out of scope for 84.1 if:** Always — recommend roadmapping into a future product phase, not 84.1 cleanup.

**Acceptance criteria:**
- Pipeline can move a draft through `pending_approval → approved → sent`
- Both snapshots persist correctly at each transition

**Phase reference:** Schema from pre-Phase-64 (Dec 2025); intended for Phase 75 governance group; never built

---

### T-08-E — Wire analyst-correction UI for `agent_skill_evolutions` feed (or retire)

**Table affected:** `agent_skill_evolutions`

**Status discovered:** **Writer exists and is wired** (Phase 71b). Empty because the upstream `extraction_correction_log` has 0 rows — `logCorrection()` is never called by any production code path.

**Findings from audit:**
- Writer at `src/lib/learningLoop/evolutionStager.ts:79` (via `stageEvolutionIfNeeded()`)
- Caller at `src/lib/learningLoop/correctionLogger.ts:52` — fire-and-forget from `logCorrection()`
- Gate: `extraction_correction_log` must have ≥3 rows for same `(document_type, fact_key)` AND error_rate > 5%
- `extraction_correction_log` count: **0**
- No grep hits on `logCorrection(` outside the learningLoop module itself — zero callers of the public API

**Required to make live (if "build"):**
1. Find or design the analyst-correction UI/API surface (where analysts see a wrong extracted fact and correct it)
2. That surface must call `logCorrection()` with the corrected fact + context
3. Once `extraction_correction_log` starts accumulating, `stageEvolutionIfNeeded()` will fire automatically once thresholds are met

**Required to retire (if "drop"):**
1. Confirm with product that the agent self-improvement loop is no longer in scope
2. Migration to `DROP TABLE public.agent_skill_evolutions` + `extraction_correction_log`
3. Remove `src/lib/learningLoop/` module entirely (correctionLogger, evolutionStager, types)

**Estimated scope:** Investigation + product decision. If build: 1–2 weeks (analyst-correction UI is non-trivial). If retire: tiny (1 migration + module removal).

**Out of scope for 84.1 if:** Product wants to defer the decision. Revisit at Phase 86.

**Acceptance criteria (build):** ≥ 1 row from a real agent-proposed skill change reaching the human approver via the analyst-correction pipeline

**Acceptance criteria (retire):** Table + upstream `extraction_correction_log` dropped; learningLoop module removed; no orphan references

**Phase reference:** Phase 71b. Writer + stager shipped; upstream caller was never wired.

---

### T-08-F — Build `borrower_request_campaigns` writer (downstream of T-08-C)

**Table affected:** `borrower_request_campaigns`

**Status discovered:** No writer found. Schema includes FK `canonical_execution_id → canonical_action_executions.id`. Cannot populate before T-08-C produces its first row.

**Findings from audit:**
- Zero `.insert()` on the table
- Zero RPC writers
- Depends on `canonical_action_executions` being live (T-08-C)
- Schema implies: when a canonical action of type "borrower_request" succeeds, a campaign row should be created to track multi-step borrower outreach

**Required to make live:**
1. T-08-C must ship first (or at least have `canonical_action_executions` receiving rows)
2. Campaign-creation hook that fires when a `canonical_action_executions` row of type `"borrower_request"` succeeds
3. Status state machine: `pending → sending → sent → completed | failed`
4. Dispatcher integration with email/SMS providers
5. Readers for dashboard/reporting

**Estimated scope:** Medium-large. Depends on T-08-C scope.

**Out of scope for 84.1 if:** T-08-C is deferred, canceled, or T-08-G reveals no production activity to justify the feature.

**Acceptance criteria:**
- ≥ 1 row linked back to a `canonical_action_executions` row via `canonical_execution_id`
- Status correctly transitions on send

**Phase reference:** Post-close monitoring group (migration `20260511_post_close_monitoring.sql`); never finished

---

## Section 6 — Meta-finding: Wave 3 governance stalled mid-build; production activity is the gating question

The governance layer was built bottom-up across Phases 65E / 71b / 73 / 75 / post-close-monitoring: schemas first, then writers for ~half of them, then callers for only one (deal_decisions via `/actions/approve`). The empty governance tables are **not evidence of broken infrastructure** — they're evidence of a system that was staged in-flight and never got real users to exercise it.

**The production-activity finding (T-08-G) is gating for Phase 84.1 priorities:**

- If **no live banks are using Buddy today**, the right Phase 84.1 move is to deprecate or pause the 3 schema-only tables (T-08-B, T-08-D, T-08-F) rather than build writers nobody will exercise. T-08-A and T-08-C become low-priority.
- If **live banks exist** but real deals aren't showing up in queries, T-08-G's answer reshapes the audit itself: there's an RLS/tenancy bug hiding real data, and every empty-table finding in Phase 84 (including T-04's 0 extraction runs and T-07's ai_risk_runs sparsity) needs re-examination.
- If **live banks exist AND real deals are visible** (but we just didn't query them), the ticket priority stays roughly as-ordered: T-08-A first (unblock approve), T-08-C second (investigate Execute Action), T-08-E third (wire analyst corrections), retire 3 schema-only tables unless product wants them.

**Phase 84.1 should consider** whether to (a) finish each writer individually as separate tickets, (b) deprecate orphan schemas, or (c) consolidate the governance layer into a single coherent design before further build. The right choice depends on T-08-G.

---

## Acceptance criterion (T-08 audit ticket itself)

The original v2 spec criterion was "≥ 1 row in each governance table." That criterion was based on a wrong premise (writers exist, just need a smoke). The new acceptance criterion is:

**For each governance table, this audit identifies (a) whether a writer exists in the repo, (b) whether the writer is reachable in production, (c) what specifically blocks population, and (d) the Phase 84.1 work needed to make it live. Tables remain empty by truth, not empty waiting to be faked.**

Tables remain empty after T-08 closes. That's the correct state.

---

## Tickets to add to Phase 84.1 backlog (committed via this audit)

**Ordered by priority, gating tickets first:**

1. **T-08-G** — Production activity baseline. GATES the priority ordering of every other T-08-* ticket. 30 min of org digging. Highest leverage.
2. **T-08-A** — Investigate reconciliation rarity + CONFLICTS-bias (unblocks `deal_decisions` naturally once understood)
3. **T-08-C** — Investigate why `executeCanonicalAction` is never invoked (small-medium; writer + route live, UI/trigger unclear)
4. **T-08-E** — Wire analyst-correction UI feed (or retire `agent_skill_evolutions` + `extraction_correction_log`)
5. **T-08-B** — Build `agent_approval_events` writer, or confirm deprecated
6. **T-08-F** — Build `borrower_request_campaigns` writer (downstream of T-08-C)
7. **T-08-D** — Roadmap `draft_borrower_requests` AI-draft pipeline (NOT 84.1 — multi-week feature for Phase 85+)

Plus the Wave-3-completeness meta-ticket noted in Section 6 ("decide: finish each writer, deprecate orphans, or redesign the governance layer holistically").
