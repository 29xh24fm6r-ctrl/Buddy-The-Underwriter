# Package generation reliability — September 23, 2026

## Production evidence

The failed QA run `wrun_01M37Y08GTXSA3FW8WND1NMT3F`, bundle `c5621db2-fbe4-4a00-915f-e2dedc4c31ef`, admitted hash `b41d24a89cfd4412f4aa1d5415534256f649cf20159400e3e4dee9f32c3d3a8d` and failed on `7409b592b426b52cd68e3bde3b22229f927b88263da85b133550cb3afc41a0e9`.

Changing only the stored manifest's `deals.brokerage_comms_last_run_at` from `2026-09-23T19:41:04.521+00:00` to `2026-09-23T20:11:12.085+00:00` reproduces the exact failed hash. The deal's communications ledger independently records the scheduler at that time. No borrower edit is needed to explain the failure.

The run also recorded four refused generator calls while 36,447 settled tokens plus 107,591 active reservations occupied the 150,000 per-role run allowance. Five calls settled approximately ten seconds later. Final generator usage was 63,782. Overall usage was 224,307 tokens across 29 successful calls; no reservations remained unsettled.

The business-plan reviewer flagged supplied pricing, transaction volume, location and opening timetable as unsupported because its evidence omitted saved interview answers. The final saved plan consequently contradicted those answers and other sections. These figures were synthetic borrower assumptions, not independently verified market facts.

## Repair

- Snapshot schema v11 excludes only the deal-level communications cursor. Historical v10 hashing remains reproducible. Real loan values, lifecycle decisions, documents and borrower answers remain significant.
- The package-format identity advances to v3. Old in-flight schemas stop explicitly as superseded; they are not silently relabeled or admitted under new semantics. Previously generated artifacts cannot be adopted merely because financial figures match an older package identity.
- Every inner factory snapshot check loads and requires the original admitted manifest under its bundle/lease/input identity. Missing evidence fails closed. Drift diagnostics no longer claim every category changed when the original evidence is unavailable.
- Package model requests queue by run and role in each worker through provider completion and budget settlement. Other roles and runs remain independent. Database reservations remain the cross-worker spending authority; no allowance or estimator is weakened.
- A hard budget/accounting failure stops the pending role queue. Feasibility generation drains started work and propagates the failure rather than retrying unchanged admissions and paying to review placeholders. Successful section outputs remain available to the normal assembly path.
- Budget messages identify the run, QA-day and total-day limits and distinguish admission reservations from billed usage. Current daily-capacity blocks provide a safe UTC renewal explanation. Snapshot failures give specific recovery guidance without private hashes or source values.
- The shared borrower-context loader includes the saved package interview using the same question adapter as generation. Business-plan and feasibility review/repair now receive this evidence and its unverified qualifications. Interview timestamps are excluded from review identity; changed answers invalidate cached verdicts. Reused passes retain their warning disclosures.

## Validation

- `node scripts/run-token-free-regression.mjs`: 3,933 standard plus 24 react-server tests pass; network disabled, no skipped tests.
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: pass.
- ESLint on changed production modules: pass.
- New regressions exercise the real communications orchestrator with hashing, real reservation/settlement contracts under a seven-section burst, actual gateway scheduling/provenance, hard-denial queue draining, interview propagation through review and repair, cache invalidation, warning retention and tenant rejection.
- Existing workflow fixtures now persist the admission manifest supplied to the RPC, matching production rather than relying on absent evidence.

## Deployment and commissioning

No migration, production write, budget reset, provider/model switch or paid AI run is part of this build. The production DB schema already supplies every field used here.

Serial package-role execution trades parallel latency for predictable reservation headroom. Different workers can still contend; the atomic database guard remains authoritative and may refuse genuine run, QA or daily exhaustion. The queue does not claim to be a distributed scheduler.

After merge and deployment, use a separately authorized bounded QA run to measure the complete workflow duration, inspect generated PDFs/workbook, verify narrative consistency and ensure certification/release gates remain enforced. Passing mocked tests does not establish model-output quality or live lender readiness. Do not manufacture bank acceptance, borrower bank selection, consent, identity verification or document release to commission this build.
