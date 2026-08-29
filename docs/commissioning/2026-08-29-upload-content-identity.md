# Banker upload content-identity commissioning

Date: 2026-08-29  
Product: Buddy The Underwriter / www.buddysba.com

## Evidence and root cause

The canonical banker upload flow issues a server-recorded object key, lets the browser PUT
directly to storage, then calls the record endpoint. The record endpoint previously:

- compared browser-submitted metadata with the upload-session metadata;
- checked only GCS object existence;
- treated Supabase Storage listing errors and misses as non-fatal;
- persisted the browser-submitted SHA-256 and size as canonical deal-document facts; and
- marked the upload-session file, session, and deal complete before storage or
  `deal_documents` persistence was proven.

A completed HTTP PUT is not content evidence. A short, interrupted, overwritten, or
misreported object could therefore advance intake while deduplication, extraction, and
underwriting provenance attested to a digest that was never calculated from stored bytes.

## Repair

- Re-read the server-recorded object through the bucket-aware storage adapter.
- Derive SHA-256 and byte length from the persisted object.
- Fail closed on unavailable bytes, malformed claims, size drift, digest drift, and
  verification timeout.
- Use the upload-session filename, content type, bucket, key, and expected size rather
  than caller-submitted canonical metadata.
- Persist only the derived size and digest, including reconciliation of historical or
  interrupted rows.
- Advance the session file, session, and deal only after both byte identity and
  `deal_documents` persistence are proven.
- Require returned-row evidence for every progress mutation and explicit errors for
  progress-count reads.
- Preserve a failed object for non-destructive orphan reconciliation; no storage object
  is deleted by this repair.

## Regression contract

Unit coverage fixes the digest of known bytes and rejects size, digest, and malformed-hash
drift. Structural coverage proves stored-byte verification precedes canonical persistence,
canonical persistence precedes progress advancement, canonical metadata comes from
server/proven sources, best-effort Storage listing is absent, and progress writes require
returned-row proof.

## Scope and remaining verification

This arc changes Buddy The Underwriter application code, tests, and documentation only.
It changes no schema, dependency, credential, provider configuration, or production data.

Production-backed transactional closure requires an authorized banker upload fixture and
a verified Buddy-owned Supabase connection after Matt merges the PR. The separate nightly
`portfolio_risk_snapshots` failure remains blocked on that verified project connection
because the repository contains no migration or project reference that can establish
schema ownership safely.


## Exact-head verification

Validation on code head `99a4afa2cebd6567e367981e77cd304d2c2a187c`:

- 13,535 tests: 13,526 passed, 0 failed, 9 skipped.
- React-server tests: 18 passed, 0 failed.
- Research evaluation: 7 passed, 0 failed, 13 controlled placeholders skipped.
- Typecheck, lint, architecture, safety, legacy-write, polling, Never-500,
  schema-select, report-only drift, Build Check, Secret Scan, Route Budget, and
  public Playwright passed.
- Public Playwright: 1 passed; 5 authenticated-fixture cases skipped.
- Exact-head Vercel preview `dpl_YwHymWV6xdP7a5XkwkxtkeTNCJgN` is READY,
  SHA-matched, HTTP 200, and has no warning, error, or fatal runtime logs in the
  two-hour verification window.
- The six-file diff was inspected completely. It contains no schema, dependency,
  credential, infrastructure, production-data, or destructive storage change.
