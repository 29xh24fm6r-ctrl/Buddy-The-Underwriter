# Document download trust-boundary commissioning

## Evidence

- `POST /api/deals/[dealId]/files/signed-url` accepted a caller-provided bucket
  as the fallback for historical rows without `storage_bucket`; the stored path
  was authoritative, but the storage namespace was not.
- Both deal-document signing surfaces returned database/provider error text and
  lacked explicit private, no-store caching controls.
- Both called the best-effort ledger API and returned the signed URL even when
  the required audit insert failed.
- Inputs, response URLs, body size, and the signing lifetime were not governed
  by one contract.

## Repair

- Resolve documents by an exactly-one-of ID/path selector, scoped to both the
  authenticated deal and bank.
- Source bucket and path only from the canonical document row, with the
  configured legacy default for rows whose bucket predates the column.
- Bound identifiers, coordinates, request bodies, signed URLs, and TTLs.
- Require exact ledger success before returning a five-minute signed URL.
- Return only stable redacted errors and explicit private/no-store responses.
- Share the implementation across redirect, GET JSON, and POST JSON surfaces.

## Validation

- `node --test scripts/__tests__/documentDownloadTrustBoundary.test.mjs`
- Production-equivalent build and exact-head preview are required before merge.
- Post-merge transactional closure requires a verified Buddy-owned Supabase
  connection and authorized documents covering Supabase Storage, GCS, missing
  state, tenant mismatch, and forced audit failure.

## Rollback

Revert the route, helper, regression, commissioning-record, and ledger commits.
No schema, storage object, provider setting, or production record is mutated by
this repair.
