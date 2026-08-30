# Portal share-link trust boundary

Scope: Buddy The Underwriter only.

## Evidence and root causes

- The 48-character bearer token used `Math.random`, which is not a cryptographic random-number generator.
- Creation accepted malformed deal/checklist identifiers, duplicate or unbounded scope lists, non-integral expiry values, and unbounded recipient text.
- Share lookup selected every column, and malformed expiry timestamps were treated as valid.
- The public view could report success after an incomplete checklist read or a failed/missing deal read.
- Uploads accepted empty files and missing MIME types, returned raw internal failures, exposed storage coordinates in logs, and returned success without proving canonical document or ledger persistence. The response also read `doc.id`, although `ingestDocument` returns `documentId`, so successful uploads reported a null identifier.

## Repair

- Generate 288-bit URL-safe tokens with `node:crypto`; preserve the existing 48-character representation.
- Bound and validate deal/checklist identifiers, scope cardinality, duplicate IDs, expiry, token format, names, notes, filenames, MIME types, and byte size.
- Select only the required share-link columns and require exact returned-row evidence at creation.
- Fail malformed/expired links closed, fail authoritative read outages with HTTP 503, and require the complete requested checklist scope plus the authoritative deal row.
- Require exact stored byte length, canonical `documentId`, and durable completion-ledger evidence before HTTP 201.
- Preserve stored user bytes when downstream work is incomplete and return a non-retryable reconciliation response to prevent duplicate user uploads.
- Apply `no-store` to every response and emit only bounded phase diagnostics.

## Verification

- Focused structural/contract regression: pending exact-head execution.
- Production-equivalent build, exact preview, required GitHub workflows, and post-merge authorized fixture: pending.
- No schema, credential, provider configuration, production data, or destructive storage change.

## Open production proof

An authorized share-link fixture and verified Buddy-owned Supabase project are required after merge to prove token creation, view, object persistence, canonical document persistence, and completion-ledger evidence in production.
