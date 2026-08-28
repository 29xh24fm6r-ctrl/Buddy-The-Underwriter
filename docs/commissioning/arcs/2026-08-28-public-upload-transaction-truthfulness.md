# Public Upload Transaction Truthfulness — 2026-08-28

## Scope

Buddy The Underwriter only: the public document-link upload route, canonical borrower-upload audit persistence, production deployment health, and CI. No other product repository, database, or infrastructure was inspected or modified.

## Production evidence before repair

- `www.buddysba.com` returned HTTP 200 on build `34d7e041356bb4b9286c16c4fe479ee9887c6895`.
- Vercel reported no production runtime-error clusters in the preceding two hours.
- PR 956's Golden Trident repair was present in that production commit's ancestry.
- Full seal-to-marketplace-to-lender transactional proof remains blocked by the absence of a verified Buddy-owned Supabase connection and an authorized transaction fixture.
- The only connected Supabase project identified itself as `Pulse OS`; it was not queried or modified.

## Findings and root causes

1. Idempotency lookup failures were treated as cache misses.
2. Deal lookup failures were treated as missing deals.
3. Intake phase was fetched after storage/ingestion and its error was ignored.
4. A single-use link was consumed only after every file side effect, allowing concurrent requests to pass the initial check.
5. Link-consumption persistence was not checked.
6. Canonical borrower-upload dedupe/orphan reads ignored database errors, and orphan repair did not prove that a row changed.
7. Link metadata lookup mislabeled database outages as invalid links.
8. Link creation mislabeled deal-stage lookup outages as intake-not-started authorization failures.
9. Duplicate chaos probes made single injected failures execute twice.
10. The optional `upload_idempotency_keys` table is referenced by code but has no migration in the repository; its production ownership/state cannot be verified without the Buddy Supabase connection.
11. The primary upload endpoint mislabeled link-record database outages as invalid links.

## Repair

- Fail closed on idempotency and deal-read errors.
- Fetch bank ownership and intake phase in one pre-side-effect query.
- Validate every file's type and declared size before consuming a link.
- Atomically claim single-use links with conditional filters and returned-row proof before storage begins.
- Remove the unverified post-side-effect link update.
- Fail closed if idempotent-response persistence fails.
- Make borrower-upload dedupe/orphan reads explicit and require returned-row proof for orphan repair.
- Return explicit service-unavailable responses for primary upload-link, metadata, and creation-state outages.
- Remove duplicate chaos probes.
- Add regression guards for ordering, error handling, conditional claim semantics, and audit persistence.

## Verification status

- Repair head `570ffb52d7400eae9f33da336d2375843de7cfe3` was zero commits behind `main`.
- The complete six-file diff was inspected; it contains no schema, dependency, production-data, conflict-marker, or secret changes.
- CI run `33189939827` passed: 13,467 tests, 13,458 passed, 0 failed, 9 skipped.
- React-server passed 18/18; research passed 7/7 with 13 production placeholders still skipped.
- Never-500 passed all 8 critical routes; schema-select, report-only drift, safety, architecture, and public Playwright passed.
- Build Check, Secret Scan, Upload Architecture Guard, and Route Budget passed.
- Exact-head Vercel preview `dpl_CHwmGKjUnqMjZJ8b8Bq9vnB9nciC` was READY, returned HTTP 200, emitted the exact `x-buddy-build` SHA, and had no warning/error/fatal logs.

## Known limitations and next evidence

- At-most-once link claiming intentionally prioritizes replay prevention. A process crash after claim can consume the link before all files finish; exactly-once completion would require a Buddy-owned database lease/outbox design and a verified migration path.
- The optional idempotency table remains an evidence gap until the verified Buddy Supabase connection is available.
- After merge, verify production HTTP/build identity, runtime logs, and an authorized public-link upload fixture.
