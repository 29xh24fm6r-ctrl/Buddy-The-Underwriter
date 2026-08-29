# Storage orphan scan truthfulness

Date: 2026-08-29

## Scope

Buddy The Underwriter's super-admin storage reconciliation path only:
`src/app/api/admin/orphans/run/route.ts` and
`src/lib/storage/orphanDetector.ts`. No production data, storage object,
database schema, provider configuration, or unrelated product is changed.

## Evidence and root cause

The reconciler bounded GCS listings to the exact configured maximum, so the
provider could truncate a listing without the caller learning that it was
incomplete. Supabase Storage traversal read only the first 1,000 entries in
each folder. Even when the scanner did report `capped: true`, the route
continued comparing the partial cache to canonical `deal_documents`, wrote
`db_only` findings for objects beyond the cap, and recorded the run as
successful.

The route independently truncated source queries and both finding sets while
still returning `ok: true`. Its successful status update also lacked
returned-row proof. An unused raw-SQL implementation broadened the database
side beyond the selected bucket and prefix and cast arbitrary path segments to
UUID, making it unsafe to revive.

These are evidence-integrity defects. Orphan findings can support destructive
operator decisions even though this route does not itself delete objects.

## Repair

- Request one GCS object beyond the configured cap and cache only the admitted
  maximum, making provider truncation observable.
- Exhaust every Supabase Storage folder page before declaring a scan complete.
- Stop with a failed run and HTTP 409 before reconciliation whenever the object,
  source-row, or finding safety boundary is reached.
- Page database reads rather than silently truncating them.
- Validate bucket, directory prefix, wildcard exposure, and the maximum object
  count before creating a run.
- Batch finding inserts and require explicit errors to remain absent.
- Require returned `id` and `status` proof for both successful and failed
  run persistence while retaining distinct start/completion/failure times.
- Remove the uncalled, unscoped `exec_sql` implementation.

## Verification plan

Run the focused source regression, the repository's broad unit suite,
react-server-condition tests, research evaluation, required CI/build/security
guards, public Playwright, exact-head preview verification, and preview runtime
log inspection. Direct database and production-transaction proof remain
blocked until a verified Buddy-owned Supabase connection and an authorized
admin scan fixture are available.
