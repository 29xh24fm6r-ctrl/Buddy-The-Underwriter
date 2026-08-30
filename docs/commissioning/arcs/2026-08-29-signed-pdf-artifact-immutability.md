# Signed PDF artifact immutability

Date: 2026-08-29  
Product boundary: Buddy The Underwriter only  
Repository baseline: `9fe4b2471558fbd0e749c0ed6718ae12ea542482`

## Evidence

SignWell completion stored the canonical compliance PDF at a deterministic provider-document path with `upsert: true`. A retry after storage success but before `signed_documents` persistence, or two concurrent webhook deliveries, could therefore replace the bytes at the same trusted path before the durable database record converged. The completion path also accepted a successful upload response without reading the object back, so a database row could attest to bytes that were not proven retrievable and identical.

## Root cause

Webhook replay recovery treated the completed PDF as mutable application state. The deterministic object name supplied idempotency, but overwrite-enabled storage did not preserve immutability or prove the authoritative bytes behind the name.

## Repair

- Upload completed PDFs with `upsert: false` so the first canonical object wins.
- Treat only explicit duplicate-object responses as a retry candidate; storage outages remain failures.
- Download the stored object after both a fresh create and a duplicate response.
- Compare byte length and SHA-256 with the provider-completed PDF before inserting `signed_documents`.
- Fail closed on missing, unreadable, or mismatched stored bytes. No object is overwritten or deleted.

## Regression coverage

Behavioral tests cover fresh persistence, identical duplicate recovery, mismatched existing bytes, non-conflict storage outages, and unreadable post-upload objects. Existing SignWell completion tests now model create-once storage and require `upsert: false`.

## Production verification

Pending merge and deployment. Transactional closure requires an authorized completed SignWell test document and a verified Buddy-owned Supabase connection so the stored object and `signed_documents` row can be inspected together.

## Unresolved evidence

- Historical signed PDFs created before this repair do not carry a stored digest in the current repository schema; this change prevents new overwrite drift and verifies new completion writes but does not claim a retroactive inventory.
- PR 878's complete Golden Trident seal-to-marketplace-to-lender transaction still requires a verified Buddy-owned Supabase connection and authorized fixture.
- The nightly `portfolio_risk_snapshots` production repair remains isolated in PR 979 and requires that same verified connection for schema confirmation and deployment closure.

## Next target

Audit signing request uniqueness and concurrent request creation so identical deal/form/signer submissions cannot create multiple provider ceremonies.
