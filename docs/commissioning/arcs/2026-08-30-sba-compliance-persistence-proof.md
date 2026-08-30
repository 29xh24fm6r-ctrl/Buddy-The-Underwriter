# SBA compliance lifecycle persistence proof — 2026-08-30

## Scope

Buddy The Underwriter scheduled SBA compliance helpers only:

- stale signed-document lifecycle gaps
- overdue third-party order gaps
- E-Tran certificate-expiry discovery
- official SBA/IRS template staleness persistence

The shared `/api/cron/sba-checks` route is intentionally unchanged because an existing open repair owns that file.

## Evidence and root cause

- Gap upserts treated an error-free PostgREST response as proof that every requested gap persisted.
- Compare-and-set resolutions counted attempted rows even when the `status = open` predicate matched nothing.
- Template-staleness writes incremented the written count without proving the intended row and state were returned.
- E-Tran credential discovery issued one unpaged query, so the Data API row cap could hide expiring credentials.

These paths could report complete compliance reconciliation while durable state was absent or incomplete.

## Repair

- Require exact returned-row identity and state for stale-signature and overdue-order gap batches.
- Require each compare-and-set resolution to return exactly the intended resolved row.
- Require template updates to return the exact template id, timestamp, and stale state.
- Paginate E-Tran expiry reads with stable deterministic ordering.
- Add regression cases for missing returned-row proof, lost compare-and-set transitions, pagination beyond 1,000 rows, and database read failure.

## Safety

Source and tests only. No schema, credential, provider configuration, production row, storage object, dependency, destructive action, or cross-product change.

## Exact-head validation

Validated on `28e7e908f3a3dbb256f0efd0e963848e1fc3686a` before this evidence-only commit:

- 18/18 exact-source boundary assertions passed.
- Complete ten-file diff inspected: +372/-37 with no secrets or unexpected scope.
- GitHub reports mergeable and zero commits behind `main`.
- Vercel deployment `dpl_CZr7pkYdbdhJLn5AtoNoHZRLKsqS` is READY and SHA-matched.
- Exact preview homepage returns HTTP 200.
- No preview warning/error/fatal runtime logs.
- CI, Build Check, and Secret Scan failed before executing any step; the inspected CI job has `steps: null` and no log URL.

## Closure

Do not merge until GitHub Actions runner/billing availability is restored and the required checks execute and pass. Transactional closure then requires the verified Buddy-owned Supabase project and authorized fixtures.
