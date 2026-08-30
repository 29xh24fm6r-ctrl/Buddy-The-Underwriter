# Plaid connection scope and truthfulness — 2026-08-30

## Scope

Buddy The Underwriter's authenticated borrower Plaid link-token, public-token exchange, connection persistence, and initial transaction-sync boundary.

## Evidence

- The exchange route accepted a client-supplied `ownership_entity_id` and persisted it without proving that the entity belonged to the authenticated borrower deal.
- The database foreign key proves only that the entity ID exists; it does not prove the entity belongs to the same deal.
- After connection persistence, the route returned `ok: true` even when the bounded initial `syncTransactions` call returned `ok: false`.
- The borrower UI marks a bank connected whenever the exchange response is green, so the route could show a connected state without transaction-sync evidence.
- Plaid SDK and PostgREST messages were returned through the authenticated borrower response, exposing internal provider and database diagnostics.

## Root cause

The route treated client metadata as trusted association evidence, and treated connection-row persistence as equivalent to a completed initial data sync. Provider/service helpers also returned diagnostic strings instead of a public error contract.

## Repair

- Treat non-empty ownership-entity IDs as tenant selectors.
- Validate their UUID shape and prove `id + deal_id` against the authenticated borrower session before link-token creation or token exchange.
- Fail closed with 400, 403, or 503 outcomes for malformed, cross-deal, or unavailable ownership evidence.
- Return HTTP 503 when initial transaction sync fails, while explicitly recording that the connection row was persisted.
- Require a returned connection-row ID before exchange persistence can succeed.
- Replace raw provider/database exception strings with deterministic public error codes and bounded server-side diagnostics.
- Preserve the existing deal-level flow when the UI omits an ownership entity.

## Regression coverage

`connectionBoundaryTruthfulness.test.ts` proves:

- ownership scope uses both entity ID and authenticated deal ID;
- both Plaid actions enforce scope before provider work;
- failed initial sync precedes and prevents a green response;
- exchange failures expose only deterministic codes;
- connection persistence requires returned-row identity;
- the borrower UI marks connected only after a green exchange response.

## Validation ledger

- Focused and broad test results: pending CI on the exact PR head.
- Complete diff inspection: pending final head.
- Exact-head preview, public smoke, and runtime logs: pending deployment.
- No schema, dependency, credential, provider-configuration, production-data, or destructive change is included.

## Production and dependencies

- PR 878 remains merged and deployed. Complete Golden Trident seal-to-marketplace-to-lender transactional proof still requires an exact verified Buddy-owned Supabase project connection and an authorized sealed fixture.
- The August 30 nightly run again failed because `public.portfolio_risk_snapshots` is absent from the live schema cache. PR 979's code is deployed, but its migration is not applied to the live Buddy database. The smallest required action is to expose or confirm the exact Buddy-owned Supabase project reference, apply that non-destructive migration to that exact project, and verify the returned schema evidence.
- Post-merge Plaid closure requires an authorized borrower sandbox fixture covering an entity-scoped connection and a controlled initial-sync failure.
