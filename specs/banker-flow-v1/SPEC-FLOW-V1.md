# SPEC-FLOW-V1 — End-to-End Banker Road

**Status:** In progress. PR1 + PR2 shipped; PR3 in development.
**Path:** specs/banker-flow-v1/SPEC-FLOW-V1.md
**Filed retroactively:** 2026-05 (originally written in chat during PR1 preparation; never committed before SPEC-13.5 spin-off)

## Context

Audit on 25 deals over 60 days revealed that exactly 1 deal had ever reached `underwriting` stage (Samaritus) and zero deals had ever produced a `credit_memo_snapshots` row with `status='banker_submitted'`. The road from `/deals/new` to "memo submitted" had five hard stops, each invisible because the next stop made the prior one unreachable.

## The five hard stops

1. **/deals/new captures only deal name/mode/files** — no borrower, no loan amount, no use of proceeds. Bankers later have to reconstruct this metadata from documents.
2. **BTR review wall** — 72% of business tax returns hit `needs_review` at classification confirm, blocking forward progress.
3. **Spread janitor stall** — 337 `spread_run_stalled` events from a small number of run_ids; alarms fire but don't terminate the runs.
4. **MemoCompletionWizard writes legacy table** — the wizard writes to `deal_memo_overrides` (legacy jsonb), which the canonical readiness gate ignores. (Addressed structurally by SPEC-13.5.)
5. **BankerReviewPanel not mounted on canonical credit-memo page** — the 693-line component with the working submit workflow exists, but `/deals/[dealId]/credit-memo` doesn't import it. The submit button is unreachable.

## PR sequence

- **PR1 (Fix #1)** — Mount BankerReviewPanel on `/deals/[dealId]/credit-memo`. Shipped at `2647e1a4`.
- **PR2 (Fix #6)** — Mount CommitteeAnticipationPanel as the diagnostic companion. Shipped at `ee569aa5`.
- **PR3 (Fix #2)** — Lifecycle.advanced events on submit. _This spec._
- **PR4 (Fix #3)** — Spread janitor termination + run_id backfill.
- **PR5 (Fix #4)** — Deal-creation guidance fields (borrower, loan amount, use of proceeds).
- **PR6 (Fix #5)** — Verification of SPEC-13 / SPEC-INTAKE-V2 status (drift findings filed at `specs/follow-ups/SPEC-FLOW-V1-blockers.md`).

## Architectural notes

- This is a banker-flow spec. Borrower-flow surfaces (Builder Story step, recovery wizard, cockpit memo-overrides) are explicitly out of scope.
- Fix #1c (CommitteeAnticipationPanel mount on credit-memo + MemoInputsBody) was promoted to PR2 after audit determined the existing engine + 8 rule modules were complete enough to ship as a separable diagnostic.
- SPEC-13.5 was a structural spin-off discovered during PR1's V-12 walk and is now closed (PR-A + PR-B + PR-C all merged).

## Build principles codified by this work

- **#15:** PIV grep audits without complete output cannot conclude completeness. Use of `head` truncates evidence; conclusions drawn from truncated greps must be re-verified before code lands. _(Source: SPEC-13.5 PR-C audit found three legacy writers across three rounds because the first grep used `head -30`.)_
- **#16:** Every PR's first action is to re-verify the spec's premises against current code, not against the spec's writing date. Specs drift from on-disk reality faster than expected. _(Source: SPEC-13.5 PR-B caught a pre-shipped deprecation shim that the spec assumed still needed building.)_
- **#17:** Spec corrections committed before implementation, not folded into the implementation commit. Future readers should see why the implementation differs from the original spec text. _(Source: SPEC-13.5 PR-B audit-correction commit `260fcd00` preceded code changes.)_
