# Lender marketplace read integrity — 2026-08-30

## Scope

Buddy The Underwriter's canonical lender identity, matched-listing feed, and granted-deal detail boundaries.

## Evidence and root cause

- The listing query did not select `deal_id`, but the response attempted to exclude test applications using `listing.deal_id`; the exclusion therefore could not work.
- Test-deal, claim, checklist, document, timeline, membership, and agreement read errors were ignored or collapsed into empty/denied state.
- An authenticated user with multiple active lender agreements was assigned whichever agreement row the database returned first.
- Raw database errors and deal identifiers crossed responses or runtime logs, and lender read responses were cacheable by default.

## Repair

- Carry `deal_id` only through the server-side isolation check, then remove it from the public feed.
- Query test status only for returned listing deals and chunk large identity sets.
- Require every listing, isolation, claim, grant, deal, checklist, document, and timeline read to succeed before returning `ok: true`.
- Distinguish missing lender authority from unavailable authoritative state.
- Reject multiple active lender identities instead of choosing one nondeterministically.
- Return bounded, no-store, non-sensitive outcomes and keep runtime logs identifier-free.
- Add behavioral identity-selection coverage and structural guards for the complete HTTP boundary.

## Safety

Source, tests, and commissioning evidence only. No database, schema, policy, credential, provider, production row, storage object, dependency, destructive action, or cross-product change.

## Closure

Post-merge transactional closure requires a verified Buddy-owned Supabase connection and authorized fixtures for a test listing, multiple active lender agreements, read failure, a valid package grant, and a fully populated lender detail response.
