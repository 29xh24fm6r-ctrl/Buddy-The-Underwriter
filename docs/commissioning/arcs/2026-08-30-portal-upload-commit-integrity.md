# Borrower portal upload-commit integrity

Scope: Buddy The Underwriter and `www.buddysba.com` only.

## Evidence and root cause

- The borrower portal sent each real file's byte length only to commit, while
  prepare persisted every session file with `size_bytes = 0`. Commit compared
  those values and rejected every non-empty file as a size mismatch.
- Commit accepted browser-supplied path, filename, MIME type, size, and a
  hard-coded storage bucket instead of using the prepared session-file record as
  authority.
- It never re-read the stored object, so canonical size and provenance could
  attest to browser claims rather than persisted bytes.
- Session-file, session, borrower-request, document-job, receipt, and readiness
  failures were ignored or treated as successful completion.
- Database/provider errors, storage paths, internal IDs, and stack traces could
  reach logs, ledger metadata, or borrower responses.

## Repair

- Require a bounded positive byte length during prepare, persist it, and prove
  the exact session-file row before returning a signed URL.
- Bind commit to UUID deal/session/file evidence and require exact equality for
  deal, bank, object key, filename, MIME type, and byte length.
- Source bucket and object key only from the prepared row, download the stored
  object, and derive its byte length and SHA-256 before intake initialization or
  canonical persistence.
- Reconcile an interrupted existing canonical row only when its stored identity
  matches; otherwise fail closed.
- Scope borrower-request writes to the authenticated deal and require returned
  row proof for request, file, session, and queue transitions.
- Await readiness, receipt, ledger, snapshot, and queue boundaries. Incomplete
  processing returns a bounded non-green response with no-store caching.
- Preserve storage objects and existing audit rows for non-destructive retry and
  reconciliation.

## Verification plan

- Run the focused parser, identity-binding, ordering, persistence-proof, and
  response-safety regression suite.
- Run the production-equivalent Next.js build and all repository-required CI.
- Inspect the complete diff and exact-head Vercel preview, including build SHA,
  public HTTP response, and warning/error/fatal logs.
- After merge, use an authorized borrower fixture and the verified Buddy-owned
  Supabase project to prove prepare, object upload, commit, canonical document,
  queue, receipt, request state, and session completion as one transaction.

## Independent blockers

- PR 878 is deployed, but complete Golden Trident seal-to-marketplace-to-lender
  proof still requires the verified Buddy-owned Supabase project and an
  authorized sealed fixture.
- The live `portfolio_risk_snapshots` migration remains unverified for the same
  exact-project ownership reason. No unverified database was queried.
