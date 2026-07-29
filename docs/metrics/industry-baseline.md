# Beat conditions — industry baseline

SPEC-M2 BEAT-METRICS-1's five metrics (`ttfa_minutes`, `formless_start`,
`repeat_ask_count`, `doc_request_rounds`, `lender_followup_count`) are
tracked against the following baseline figures — the published comparison
line for the "beat conditions" the program is built to move.

## 1. Time to close: 60–90 days

An SBA 7(a) loan typically closes in 30–90 days from application, with 60–90
days a realistic average for a well-prepared application through a
non-Preferred-Lender bank; Preferred Lender Program banks can bring this
down to 20–45 days. Reactive document gathering (not pre-organized
documents) is cited as one of the two most common reasons deals run 90+
days instead of 60.
[Crestmont Capital: SBA Loan Timeline to Close 2026](https://www.crestmontcapital.com/blog/sba-loan-timeline-to-close-2026)

`ttfa_minutes` doesn't measure the full close timeline — it measures the
much narrower "time to first readiness read," a leading indicator for
whether the front end of that 60–90 day window is being compressed.

## 2. Document-gathering time: ~30 days

Cited internally as a working assumption for how much of the 60–90 day
total timeline is typically consumed by back-and-forth document collection
specifically (as opposed to underwriting, committee, and closing steps).
**Not independently sourced for this doc** — flagged here rather than
presented as a verified statistic. If a harder citation is found, replace
this line; until then, treat `doc_request_rounds` and `repeat_ask_count`
as the metrics that would actually move this number, and let the program's
own before/after data (once M4/M5 ship) become the real evidence.

## 3. Underwriting exception rate: ~1/3

Cited internally as a working assumption for the share of applications
that generate at least one banker exception/clarification request during
underwriting. **Not independently sourced for this doc** — a search for a
published SBA or industry statistic specifically on "exception rate" did
not surface one; this figure came from the program's own framing, not a
citation. Treat it the same way as (2): a stated assumption to validate or
correct once real doc_request_rounds / clarification data accumulates.

## What "beating" these means for each metric

| Metric | Baseline | Target direction |
|---|---|---|
| `ttfa_minutes` | n/a (no equivalent baseline metric exists industry-wide) | < 15 minutes |
| `formless_start` | 0% (all SBA applications start with a paper/PDF form today) | → 100% |
| `repeat_ask_count` | Not tracked industry-wide; anecdotally common | 0, hard-enforced by CI (see `scripts/synth-borrower-e2e.ts`) |
| `doc_request_rounds` | Anecdotally 3–5+ rounds is typical for a reactive process | ≤ 1 |
| `lender_followup_count` | Baseline exception rate ~1/3 of packages (unsourced, see above) | trend → 0 |

## Honest instrumentation note

As of SPEC-M2, `ttfa_minutes` and `repeat_ask_count` will show "no data
yet" on the dashboard — the experiences that generate real signal for them
(SPEC-M3 Glass Box, SPEC-M5 Conversational Intake) haven't shipped. That's
expected, not a bug: the instrumentation and its CI enforcement exist now
so those specs report into a working scoreboard from day one, per the
program's "metrics-first" invariant.
