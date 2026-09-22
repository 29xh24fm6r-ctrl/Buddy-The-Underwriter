# Borrower package: no-spend preflight repair

## Problem

The September 22 QA run failed during canonical credit because the verifier QA allocation was exhausted. The existing admission check read only the global daily ledger: 218,170 QA verifier tokens plus a 39,608 reservation exceeded the 250,000 QA limit, even though the error displayed the 500,000 global limit. A second known deterministic failure, feasibility evidence completeness, was discovered only after paid artifact generation.

## Changes

- Check daily, QA and package-run headroom before package generation; check package capacity before borrower research too. Read reservation pages fully and use actual usage when settled, including actual zero. Fail closed on tenancy or ledger errors. No cap increase, ledger reset or budget reservation bypass.
- Before the first final-package model call, run the canonical memo consistency checks and the real feasibility analyses against the same immutable financial snapshot. Reuse the publication completeness policy. This path does not generate narratives, render, upload or save a feasibility study.
- Give capacity-specific wait guidance instead of suggesting immediate retries. Explain evidence gaps without falsely claiming the documents are already prepared.
- Add `pnpm test:token-free`, with fetch/socket network disabled in both ordinary and react-server suites. CI runs it as a blocking step. Coverage includes borrower input/preparation, documents, forms, financial lineage, memo, feasibility, scores, publication, release and AI gateway contracts. Providers and external services are mocked; this is not a claim about live model quality.
- Add the manual **Borrower QA Research Fixture** workflow, main branch only, using the existing Production environment database secrets. It runs the previously reviewed `scripts/qa/commission-7brew-research.sql` and verifies the rows. The SQL checks the exact test deal/bank/name/geography, rejects active package runs and incomplete prior fixtures, and is repeat-safe. It cannot create scores, final artifacts, identity verification, bank acceptance or a borrower release.

## Verification performed without provider calls

- 3,815 regression tests passed across 396 files, with zero skips; the additional local SQL fixture test passed separately (3,816 total).
- TypeScript passed; changed runtime files passed ESLint with no errors. The CommonJS network preload has two import-style warnings. Column-existence guard and diff checks passed.
- Replayed the actual QA application's saved financial snapshot and current inputs locally with the real feasibility and memo preflight functions; all network connections disabled. Memo consistency passed. Current evidence completeness was **0.475**, correctly blocked before generation.
- Executed the exact QA research SQL twice in local Postgres (PGlite), using production research column types/defaults and CHECK/PK/unique constraints captured read-only. One mission, three sources and five facts remained. Replaying the same financial snapshot with those synthetic inputs produced **0.71** completeness. Remaining gaps stay visible; no financial numbers or thresholds were changed to obtain this result.
- SQL tests reject non-test applications, active package runs and incomplete existing fixtures.
- Read-only production audit: preparation, proceeds-sync, budget-reservation, stage and final-publication RPCs exist with service-role execute permission. Required `bank-forms`, `deal-documents`, and `trident-bundles` buckets exist and are private. This confirms presence/access metadata, not runtime write success.

## Remaining rollout / limits

1. Merge and deploy this repair; confirm CI and Vercel are green.
2. Run **Borrower QA Research Fixture** on main and verify success. It has NOT been run in production by this change. The connected SQL session is `supabase_read_only_user` with read-only transactions; the separate Buddy MCP database connector returns an internal error. The manual workflow uses the previously configured, separate authorized database connection.
3. Leave paid generation paused. QA verifier usage is 218,170 against a 250,000 daily allocation on 2026-09-22 UTC. Do not increase limits or reset accounting; wait for capacity and rerun no-spend admission checks.
4. A mocked regression and local data replay cannot prove the content of a future model response or future service availability. Final live narrative acceptance, institutional reviews and live final score publication remain unverified. Identity/signing and bank acceptance are separate real-world gates, never fabricated to pass a test. Golden Trident borrower release remains gated by bank acceptance.

Admission is a read-only capacity estimate, not a reservation for the whole job. Concurrent usage can still reduce headroom after admission; per-call atomic reservations remain authoritative. These repairs remove known avoidable spend and improve detection; they do not certify that every possible production failure has been eliminated.
