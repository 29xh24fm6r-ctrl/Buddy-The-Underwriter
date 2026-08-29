# Atomic seal and marketplace-listing lifecycle

Date: 2026-08-29

Scope: Buddy The Underwriter only (`29xh24fm6r-ctrl/Buddy-The-Underwriter` and `www.buddysba.com`).

## Evidence and root cause

- PR 878's Golden Trident delivery code is deployed, while complete transactional proof remains blocked on a verified Buddy-owned Supabase connection and an authorized transaction.
- Seal creation wrote `buddy_sealed_packages`, then `marketplace_listings`, then `deals.status` as independent requests.
- A listing failure relied on a best-effort compensating update whose error and affected-row count were ignored. A failed compensation could leave an active seal with no listing and permanently block retry.
- The final deal-status update was also unchecked, so the route could report success while the deal remained in its prior state.
- Borrower unseal repeated the same pattern: it discarded the listing read error, ignored all three mutation results, and could return success after only a subset of package, listing, and deal state changed.
- The rate-card query discarded database errors, misclassifying unavailable authoritative state as a configuration miss.

## Repair

- Add a service-role-only `create_buddy_seal_listing` RPC that locks the tenant deal, coordinates with Golden Trident publication, re-proves the exact current certified bundle and all three artifact paths, inserts the sealed package and listing, advances the deal to `sealed`, and returns both persisted ids in one transaction.
- Add a service-role-only `unseal_buddy_marketplace_listing` RPC that locks the eligible pending-preview listing and active tenant package, proves every update/delete, returns the deal to `draft`, and rolls back the whole transition on any failure.
- Replace route-level best-effort compensation with the atomic RPCs and require returned-id proof before reporting success.
- Distinguish a rate-card database error from a genuine missing rate-card row and fail unavailable state closed with HTTP 503.
- Keep both privileged functions on an empty search path and revoke execution from `PUBLIC`, `anon`, and `authenticated`.

## Verification plan

- Focused static regression coverage proves route delegation, absence of direct lifecycle writes, tenant/bundle/artifact proof, transaction ordering, zero-row exceptions, function hardening, and rate-card error ordering.
- Required CI, build, security, schema, and browser checks must pass on the exact PR head.
- The exact-head Vercel preview must be READY, HTTP 200, SHA-matched, and runtime-clean.

## Production closure

After Matt merges, use the confirmed Buddy-owned Supabase project and authorized fixtures to prove:

1. A forced listing failure leaves no active sealed package and no deal-status change.
2. A successful seal returns persisted package/listing ids and advances the deal to `sealed`.
3. A forced unseal substep failure rolls back package, listing, and deal state.
4. A successful pending-preview unseal marks the package, removes the listing, and returns the deal to `draft`.

No production row, storage object, credential, provider configuration, or other product system is changed in this branch.

