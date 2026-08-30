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

## Validation state

- Complete changed-file diff inspected.
- Branch is zero commits behind `main`.
- Required CI and exact-head preview evidence will be recorded after the pull request is opened.
- Transactional closure requires the verified Buddy-owned Supabase project and authorized fixtures.
