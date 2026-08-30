# Canonical document download authorization and integrity

Date: 2026-08-29  
Scope: Buddy The Underwriter only

## Checkpoint

- PR 995 remains open, mergeable, and based on current main.
- PR 878 remains deployed. Its complete seal-to-marketplace-to-lender
  transactional proof still requires a verified Buddy-owned Supabase connection
  and an authorized sealed fixture.
- This arc is source-independent from PR 995 and does not modify its worker files.

## Evidence and root cause

Three authenticated document download surfaces shared one incomplete trust boundary:

- The canonical signed-URL routes loaded a `deal_documents` locator but did not
  read or verify the row's persisted `size_bytes` and `sha256` before signing
  the provider object.
- The POST compatibility shape accepted a caller-provided storage bucket as a
  fallback for historic rows, allowing request data to influence which privileged
  bucket was signed.
- The legacy `/api/storage/signed-url` route treated a deal-prefixed path as
  sufficient evidence and signed directly from a fixed bucket without proving a
  canonical bank-owned document row.
- Database and provider error messages could escape through authenticated
  download responses.
- URLs remained valid for ten minutes even though a normal click needs only a
  short handoff window.

A corrupted, displaced, unrecorded, or metadata-incomplete provider object could
therefore receive a valid URL and be represented as the canonical underwriting
document.

## Repair

Branch: `codex/commission-document-download-integrity`.

- Resolve every download to a canonical `deal_documents` row bound to both deal
  and bank before privileged storage access.
- Ignore caller-supplied bucket claims. The object path must come from the
  canonical row; the bucket comes from that row or the server-owned canonical
  default already used for historic rows.
- Require persisted size evidence, then download and verify stored bytes before
  signing. Current rows require exact size and SHA-256 proof; historic rows
  without a digest still require exact size proof and record the actual digest.
- Centralize provider signing after proof and reduce the URL lifetime to 60
  seconds.
- Record the proven size, digest, identity strength, and URL lifetime in the
  existing document-download ledger event.
- Return deterministic, non-sensitive state and integrity failures.
- Preserve existing response fields and redirect behavior.

## Safety

No schema, dependency, credential, provider configuration, production row,
destructive operation, or cross-product change is included. No Supabase project
was queried.

## Verification

Implementation head `da31315c6477f4e60ee0fdebfd2da03c9078b983`:

- 13,622 tests: 13,613 passed, 0 failed, 9 skipped.
- React-server suite: 18 passed, 0 failed.
- Research golden set: 7 passed, 0 failed, 13 explicitly skipped placeholders.
- Typecheck, lint, architecture, safety, schema-select, Never-500, upload
  architecture, secret scan, route budget, Next.js build, and public Playwright
  passed.
- The exact-head Vercel preview was READY, returned HTTP 200, and had no
  warning/error/fatal runtime logs or grouped runtime errors.
- The complete seven-file diff was inspected: 532 additions and 340 deletions,
  with no conflicts, credentials, direct legacy signing, or unexpected scope.

This evidence-file update is documentation-only. Its resulting exact head must
also retain all required green checks before the PR is handed off.

## Closure

Regression coverage proves authorization, canonical-row binding, required size
metadata, proof-before-sign ordering, audit-before-release ordering,
caller-bucket rejection, redacted failure behavior, and removal of direct legacy
bucket signing.

Post-merge transactional closure requires a verified Buddy-owned Supabase
connection and authorized document fixtures for current SHA-backed rows, historic
size-only rows, missing-metadata rows, corrupted objects, and cross-bank denial.
