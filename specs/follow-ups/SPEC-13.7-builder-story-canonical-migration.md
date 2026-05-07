# SPEC-13.7 — Borrower-Flow Builder Story canonical migration

**Status:** Stub — filed during SPEC-13.5 PR-C (2026-05-07)
**Blocks:** Cleanup of SPEC-13.5 CI guard allowlist (removal of these two entries)
**Related:** SPEC-13.5 (banker-flow canonical cutover)

## Goal
Migrate the borrower-flow writers off `deal_memo_overrides` and into a
canonical store (likely `deal_borrower_story` extended for borrower-side
fields, OR a new borrower-flow canonical store). Removes the last
borrower-side legacy writers so the day-15 PR-D table drop is unblocked.

## Current state
Two writers in the borrower-flow journey write to
`deal_memo_overrides` via read-modify-upsert. Both are explicitly
allowlisted by SPEC-13.5 PR-C's CI guard:

### File 1 — `src/lib/builder/builderCanonicalWrite.ts:writeStoryCanonical`
Writes 6 borrower-flow fields to the legacy table:
- `use_of_proceeds`
- `principal_background`
- `competitive_position`
- `key_weaknesses`
- `key_strengths`
- `committee_notes`

### File 2 — `src/app/api/deals/[dealId]/borrower/update/route.ts`
Writes 11+ borrower-flow fields to the legacy table:
- `banker_summary`
- `website`
- `dba`
- `business_description`
- `revenue_mix`
- `seasonality`
- `collateral_description`
- `collateral_address`
- `competitive_advantages`
- `vision`
- `principal_bio_*` (passthrough)

Field set partially overlaps with the banker-side canonical fields
(`business_description`, `revenue_mix`, `seasonality`, `principal_bio_*`)
that SPEC-13.5 already migrated, plus borrower-side-specific fields not
yet in canonical (`website`, `dba`, `vision`, etc.).

## Blast radius
Borrower-flow journey: borrower portal, builder UI, intake confirmation
flow. Different consumers from the banker-side surfaces SPEC-13.5
addressed. Migrating the overlapping fields requires care — the banker-
side canonical store already has them populated for the 4 backfilled
deals; borrower-side writes must merge correctly without clobbering
banker-side content.

## Unblocking conditions
1. Decide canonical-store strategy: extend `deal_borrower_story` with
   borrower-side-specific fields, OR create a separate borrower-flow
   canonical store (`deal_borrower_journey` or similar).
2. Map each of the 17 unique fields to a canonical column (or to a
   typed sub-store).
3. Audit consumers of both writers: identify all UI surfaces and API
   callers; plan the cutover order.
4. Migrate writers one at a time (start with `borrower/update/route.ts`
   — single endpoint, well-scoped). Validate against borrower flow tests.
5. Migrate `builderCanonicalWrite.ts:writeStoryCanonical`.
6. Remove both entries from
   `scripts/check-no-legacy-overrides-writes.sh` allowlist.
7. Day-15 PR-D table drop becomes unblocked once SPEC-13.7 + SPEC-13.8
   complete.

## Out of scope
- The banker-side fields SPEC-13.5 already migrated (any overlap is
  handled by the existing canonical store).
- Frontend changes beyond what's needed to point writers at the new
  canonical endpoint.
