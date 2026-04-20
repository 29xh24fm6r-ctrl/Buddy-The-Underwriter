# AAR — Phase 84 T-08 — Governance Writer-Existence Audit

**Date:** 2026-04-20
**Ticket:** T-08 (Wave 3 — Restore advisory + governance, converted to audit-only)
**Scope:** Audit existence and reachability of writers for 6 governance tables
**Audit doc:** `docs/archive/phase-84/T08-governance-writers-audit.md`
**Completion event:** `buddy_system_events` id `46da8784-c54b-4c16-a8e4-5817631e26ff`

---

## 1. Why this converted to audit-only

v2 spec framed T-08 as a smoke test against assumed-existing writers. Pre-work proved:
1. 3 of 6 governance tables have no writer in the repo (schema-only artifacts from Phases 73 / pre-64 / post-close-monitoring)
2. 2 of 6 have working writers that have never been invoked (starved of upstream input or uninvoked UI trigger)
3. 1 of 6 has a working writer that is gated on reconciliation status that 0 deals currently meet
4. Spec endpoint paths assumed by v2 don't exist (`admin/agent-approvals`, `draft-borrower-request`); the `borrower-request` route writes to a different system (Phase 73 portal links, not Phase 75 AI-draft governance)

Synthetic fixture inserts were considered (Option B in the planning conversation) and rejected: future queries against governance tables would always need `WHERE source != 'phase_84_t08_smoke'`. Polluting the truth source to satisfy a checklist criterion is the kind of band-aid we don't ship.

---

## 2. Pre-work findings (verbatim)

### Governance table state
```
agent_approval_events:        0 rows
agent_skill_evolutions:       0 rows
borrower_request_campaigns:   0 rows
canonical_action_executions:  0 rows
deal_decisions:               0 rows
draft_borrower_requests:      0 rows
```

### Reconciliation gate
```
is_test | total | never_run | clean | flags | conflicts
true    |   9   |     8     |   0   |   0   |     1
```
```
overall_status   cnt   earliest                       latest
CONFLICTS         2    2026-04-03 23:45:36.844755+00  2026-04-14 19:00:14.754677+00
```

**All 9 deals in the DB are `is_test = true`. Zero non-test production deals anywhere.** Only 2 reconciliation runs have ever completed across the entire DB lifetime, both CONFLICTS. Headline finding — see T-08-G.

### Endpoint inventory
```
✓ FOUND   /api/deals/[dealId]/actions              → writes deal_decisions (approve/decline/escalate)
✗ MISSING /api/admin/agent-approvals
✓ FOUND   /api/deals/[dealId]/actions/execute      → executeCanonicalAction writes canonical_action_executions
✗ MISSING /api/deals/[dealId]/draft-borrower-request
✓ FOUND   /api/deals/[dealId]/borrower-request     → writes borrower_invites + borrower_request_packs
                                                      (different system — Phase 73 portal upload links)
```

---

## 3. Writer-existence map summary

| Table | Writer status | Reachable today | Phase 84.1 ticket |
|---|---|---|---|
| `deal_decisions` | ✓ exists | ✗ blocked by recon gate | T-08-A |
| `agent_approval_events` | ✗ no writer | n/a | T-08-B |
| `canonical_action_executions` | ✓ **exists + wired** | ✗ never invoked | T-08-C |
| `draft_borrower_requests` | ✗ no writer | n/a | T-08-D (not 84.1 — roadmap) |
| `agent_skill_evolutions` | ✓ **exists + wired** | ✗ starved (upstream empty) | T-08-E |
| `borrower_request_campaigns` | ✗ no writer | n/a | T-08-F (downstream of T-08-C) |

**The two bold "exists + wired" rows are significant corrections to pre-work assumptions.** Pre-work labeled them as missing/orphan; audit proved both are healthy writers waiting for upstream triggers. Full detail in [T08-governance-writers-audit.md](T08-governance-writers-audit.md).

---

## 4. Phase 84.1 tickets generated (7 total, ordered by priority)

1. **T-08-G — Production activity baseline** (gating, meta-ticket): 0 non-test deals in DB. Until this is answered, priority of the other 6 tickets is undefined.
2. **T-08-A — Investigate reconciliation rarity + CONFLICTS-bias**: 2 runs total in 17+ days, all CONFLICTS. Reframes from "drive canary to CLEAN" to "understand why recon barely runs and always produces CONFLICTS."
3. **T-08-C — Investigate why `executeCanonicalAction` is never invoked**: writer is wired; `deriveNextActions()` output or UI surface is the blocker.
4. **T-08-E — Wire analyst-correction UI for `agent_skill_evolutions`** (or retire): writer + stager are healthy; upstream `logCorrection()` caller never built.
5. **T-08-B — Build `agent_approval_events` writer, or confirm deprecated**: schema-only, Phase 73 unfinished.
6. **T-08-F — Build `borrower_request_campaigns` writer**: downstream of T-08-C; cannot start before T-08-C rows exist.
7. **T-08-D — Roadmap `draft_borrower_requests` AI-draft pipeline**: multi-week feature, NOT 84.1; queue for Phase 85+.

---

## 5. Spec deviations

1. **Full ticket converted to audit-only.** v2 prescribed a smoke script; pre-work showed there are no reachable writers to smoke. Same conversion pattern applied to T-03 and T-05.
2. **Synthetic fixture insert path rejected.** Inserting marker rows would have satisfied v2's literal "≥ 1 row in each table" criterion but polluted the governance truth source. Option C chosen over Option B for long-term integrity.
3. **v2 endpoint paths were speculative.** `/api/admin/agent-approvals` doesn't exist; `/api/deals/[dealId]/draft-borrower-request` doesn't exist; the actual `borrower-request` route writes to a different system (Phase 73 portal links, not Phase 75 AI-draft governance).
4. **Pre-work under-classified two tables.** `canonical_action_executions` and `agent_skill_evolutions` were labeled "no writer / possible orphan" in pre-work. Audit grep surfaced that both have healthy writers that are wired to callers — just starved or uninvoked. This reshapes T-08-C and T-08-E from "build writer" to "investigate upstream trigger."
5. **Reconciliation gate is the systemic unblocker.** Discovering this is the single most actionable technical output; produced T-08-A as a high-leverage ticket.
6. **Production-activity finding is the strategic unblocker.** 0 non-test deals in DB recontextualizes every "empty table" finding in Phase 84. Produced T-08-G as the gating ticket for the entire 84.1 priority ordering.

---

## 6. Meta-lesson (carried forward to 84.1 planning)

**Wave 3 governance work stalled mid-build across Phases 65E / 71b / 73 / 75 / post-close-monitoring.** Schemas shipped for all 6 tables. Writers shipped for 3. Reachable callers shipped for 1. The empty governance tables are the visible symptom of a layer that was built bottom-up but never finished top-down.

The right Phase 84.1 move depends entirely on T-08-G's answer:
- **No live banks:** deprecate the 3 schema-only tables; park T-08-A/C/E until there's reason to exercise them.
- **Live banks but no real deals visible:** RLS/tenancy bug is the actual Phase 84.1 headline, not governance. Re-examine every empty-table finding.
- **Live banks with real deals:** stay the course — T-08-A → C → E → B → F → roadmap D.

This is the fourth Wave 1/3 ticket in Phase 84 where pre-work revealed the v2 premise was partially wrong (after T-02, T-03, T-06). Future phases should invest heavier in pre-work-first scoping before locking Wave 1 tickets.

---

## 7. Phase 84.1 backlog additions

All 7 T-08-* tickets queued. Detailed scope in audit doc.

Plus the Wave-3-completeness meta-ticket noted in Section 6: **"Decide for the governance layer: (a) finish each writer individually, (b) deprecate orphan schemas, or (c) consolidate into a single coherent design before further build."** Decision depends on T-08-G.

---

## Next

T-09 — Roadmap + env reconciliation. Then T-10A (repo hygiene). 2 tickets left.
