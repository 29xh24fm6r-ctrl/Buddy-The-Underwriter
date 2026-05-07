# SPEC-FLOW-V1 — End-to-End Banker Road

**Status:** In progress. PR1 + PR2 shipped; PR3 in development.
**Filed retroactively:** 2026-05 (originally written in chat during PR1 preparation; never committed before SPEC-13.5 spin-off shipped).

## Context

Audit on 25 deals over 60 days revealed that exactly 1 deal had ever reached `underwriting` stage (Samaritus) and zero deals had ever produced a `credit_memo_snapshots` row with `status='banker_submitted'`. The road from `/deals/new` to "memo submitted" had five hard stops, each invisible because the next stop made the prior one unreachable.

## The five hard stops

1. **/deals/new captures only deal name/mode/files** — no borrower, no loan amount, no use of proceeds. Bankers later have to reconstruct this metadata from documents.

2. **BTR review wall** — 72% of business tax returns hit `needs_review` at classification confirm, blocking forward progress. (Originally addressed by SPEC-INTAKE-V2 Fix #1; drift detected in `specs/follow-ups/SPEC-FLOW-V1-blockers.md`.)

3. **Spread janitor stall** — 337 `spread_run_stalled` events from a small number of run_ids; alarms fire but don't terminate the runs.

4. **MemoCompletionWizard writes legacy table** — the wizard writes to `deal_memo_overrides` (legacy jsonb), which the canonical readiness gate ignores. (Originally addressed by SPEC-13 Fix #4; drift detected in `specs/follow-ups/SPEC-FLOW-V1-blockers.md`. Structurally sealed by SPEC-13.5 PR-B.)

5. **BankerReviewPanel not mounted on canonical credit-memo page** — the 693-line component with the working submit workflow exists, but `/deals/[dealId]/credit-memo` doesn't import it. The submit button is unreachable.

## PR sequence

| PR | Fix | Status | Commit |
|----|-----|--------|--------|
| PR1 | Fix #1 — Mount BankerReviewPanel on `/deals/[dealId]/credit-memo` | Shipped | `2647e1a4` |
| PR2 | Fix #6 — Mount CommitteeAnticipationPanel as diagnostic companion | Shipped | `ee569aa5` |
| PR3 | Fix #2 — Lifecycle.advanced events on banker submission | In dev | See `SPEC-FLOW-V1-PR3-lifecycle-advancement.md` |
| PR4 | Fix #3 — Spread janitor termination + run_id backfill | Queued | — |
| PR5 | Fix #4 — Deal-creation guidance fields (borrower, loan amount, use of proceeds) | Queued | — |
| PR6 | Fix #5 — Verification of SPEC-13 / SPEC-INTAKE-V2 status | Queued | Drift findings at `specs/follow-ups/SPEC-FLOW-V1-blockers.md` |

## Architectural notes

- This is a banker-flow spec. Borrower-flow surfaces (Builder Story step, recovery wizard, cockpit memo-overrides) are explicitly out of scope.
- Fix #1c (CommitteeAnticipationPanel mount on credit-memo + MemoInputsBody) was promoted to PR2 after audit determined the existing engine + 8 rule modules were complete enough to ship as a separable diagnostic.
- SPEC-13.5 was a structural spin-off discovered during PR1's V-12 walk and is now closed (PR-A `7c56074b` + PR-B `183e8318` + PR-C `9e5db143` all merged).
- The V-12 deferred chain (financial pipeline / research gate / doc finalization / borrower-flow consolidation) was filed at `specs/follow-ups/SPEC-13.5-V12-deferred-findings.md` for separate resolution. PR3 onward does NOT depend on those clearing.

## Build principles codified by this work

These were extracted during SPEC-13.5 PR-B and PR-C work and apply to all future spec/implementation work in this repo.

### #15 — PIV grep audits without complete output cannot conclude completeness

Use of `head` truncates evidence; conclusions drawn from truncated greps must be re-verified before code lands.

**Source:** SPEC-13.5 PR-C audit found three legacy writers across three rounds because the first grep used `head -30`. Each subsequent grep without `head` surfaced another writer that the spec hadn't enumerated. The CI guard's allowlist ended up with three entries, not zero.

**Practice:** when running PIV greps that establish the absence of something, run `grep` with no truncation, capture full output, and only declare completeness when the full output is reviewed.

### #16 — Every PR's first action is to re-verify the spec's premises against current code

Specs drift from on-disk reality faster than expected. The spec was written at time T; the code is at time T+N.

**Source:** SPEC-13.5 PR-B caught a pre-shipped deprecation shim that the original spec assumed still needed building. The wizard was already targeting a successor endpoint that existed in code but not in the spec author's mental model.

**Practice:** the first commit of any new PR is a re-verification commit (often just an audit doc). If the spec's premises hold, no further action; if they've drifted, file a spec correction commit before any implementation.

### #17 — Spec corrections committed before implementation, not folded in

Future readers should see why the implementation differs from the original spec text.

**Source:** SPEC-13.5 PR-B audit-correction commit `260fcd00` preceded code changes. Without it, the implementation diff would have had no audit trail explaining why the wiring went to a different endpoint than the spec named.

**Practice:** when a PR re-verification (per #16) finds drift, commit a separate "spec correction" commit (or amend the spec doc on main) before the implementation commits. The correction commit's message must explain what the spec assumed vs. what is now true.

## How to find related material

- This doc: parent spec (sequence + principles + audit trail).
- `SPEC-13.5-complete-cutover.md`: structural cutover that fell out of PR1's V-12 walk; closed.
- `SPEC-FLOW-V1-PR3-lifecycle-advancement.md`: in-flight PR3 spec.
- `../follow-ups/SPEC-FLOW-V1-blockers.md`: drift findings for SPEC-13 and SPEC-INTAKE-V2 prior fixes.
- `../follow-ups/SPEC-13.5-V12-deferred-findings.md`: 4-layer chain post-SPEC-13.5 (financial pipeline, research gate, doc finalization, borrower-flow consolidation).
