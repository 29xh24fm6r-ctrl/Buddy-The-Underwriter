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

A corrupted, displaced, or unrecorded provider object could therefore receive a
valid URL and be represented as the canonical underwriting document.

## Repair

Branch: `codex/commission-document-download-integrity`.

- Resolve every download to a canonical `deal_documents` row bound to both deal
  and bank before privileged storage access.
- Ignore caller-supplied bucket claims; bucket and object path come only from the
  canonical row.
- Download and verify stored bytes before signing. Current rows require exact
  size and SHA-256 proof; historic rows without a digest still require exact size
  proof and record the actual digest.
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

## Verification and closure

Regression coverage proves authorization, canonical-row binding, proof-before-
sign ordering, audit-before-release ordering, caller-bucket rejection, redacted
failure behavior, and removal of direct legacy bucket signing.

Required CI, build, exact-head preview, complete diff inspection, and post-merge
transactional proof are recorded after execution. Transactional closure requires
a verified Buddy-owned Supabase connection and authorized document fixtures for
current SHA-backed rows, historic size-only rows, corrupted objects, and
cross-bank denial.
