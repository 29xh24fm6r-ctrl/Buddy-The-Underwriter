# Borrower projection PDF trust-boundary commissioning

## Evidence

- The borrower projection route resolved a portal token but did not bind the
  authoritative deal read to the resolved bank.
- Assumptions, financial facts, research, borrower-story, and SBA-package read
  failures were silently treated as missing data, allowing a polished PDF to be
  generated from defaults or partial state.
- The route did not require the documented confirmed-assumptions state.
- Opening cash was requested from the model but the governing cash fact keys
  were absent from the database query, so non-zero cash could be rendered as
  zero.
- Storage upload used replace semantics, was not read back for byte identity,
  and delivery could be reported successful with a null URL and no durable
  audit evidence.
- The response disclosed the internal object path, used a one-hour URL, and
  lacked explicit private no-store controls.

## Repair

- Bind the deal to both portal-resolved deal and bank identifiers before using
  any deal-scoped evidence.
- Fail closed on every authoritative read and require confirmed assumptions.
- Include the governed opening-cash fact keys in the financial evidence query.
- Preserve an optional missing borrower story while distinguishing it from a
  failed story read without logging provider data.
- Render and store a bounded PDF under a collision-resistant non-upsert path,
  read it back, and require exact length plus SHA-256 identity.
- Return a five-minute HTTPS URL only after an exact tenant-bound ledger row is
  persisted; remove the just-created object when verification, signing, or
  audit proof is incomplete.
- Return only stable redacted errors and private no-store responses.

## Validation

- `node --test scripts/__tests__/borrowerProjectionPdfTrustBoundary.test.mjs`
- Production-equivalent Vercel build and exact-head preview are required before
  merge.
- Post-merge transactional closure requires a verified Buddy-owned Supabase
  project and an authorized confirmed-assumptions borrower fixture.

## Rollback

Revert the route, borrower-story evidence loader, regression, commissioning
record, and ledger commits. No schema, provider setting, production record, or
pre-existing storage object is mutated by this repair.
