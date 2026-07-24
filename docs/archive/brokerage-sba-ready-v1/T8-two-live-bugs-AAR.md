# Two live bugs found and fixed while following up on the T7 AAR's flagged items

**Date:** 2026-07-15

The previous form-generation pass (T7) flagged two items as "worth checking,
not fixed" rather than bugs. Investigating both turned out to find one real
code-quality fix (lender-name resolution) and one genuinely live, silently
broken data path (PFS capture) — both fixed this pass.

## 1. Dispatched SBA forms addressed a Brokerage deal's "lender" as "Buddy Brokerage"

**The problem:** `form4506c/inputBuilder.ts`, `form155/inputBuilder.ts`,
`form148/inputBuilder.ts`, and `form601/inputBuilder.ts` all resolve their
"Lender Name" field by looking up `banks.name` for whatever `bankId` their
caller passes — which was always `deals.bank_id`. For the Underwriter
tenant that's genuinely the lender; for a Brokerage deal it's the singleton
`BUDDY_BROKERAGE` tenant row, so every one of these forms would print
"Buddy Brokerage" as the lender, even after a real lender was picked.

**The fix:** new `src/lib/sba/package/resolveEffectiveLenderBankId.ts` —
checks `marketplace_picks` for a `status='picked'` row on the deal and
returns `picked_lender_bank_id` if one exists, else falls back to the
deal's own `bank_id`. Wired into `generatePdfForFillRun.ts` (the single
choke point every dispatched form's `bankId` flows through), so all four
forms are fixed at once rather than patched individually. Pre-pick
behavior is unchanged (still falls back to `deals.bank_id`, same as
before); post-pick, the picked lender's name now prints correctly.

Turned out there was already precedent for this exact lookup:
`src/lib/brokerage/compliancePackage.ts`'s Form 159 flow (a separate,
Brokerage-specific call path that bypasses `sbaFormDispatch.ts` entirely)
already resolves `picked_lender_bank_id` the same way for its own purposes
— this fix just applies that same logic to the other four forms, which
never had it.

Tests: `src/lib/sba/package/__tests__/resolveEffectiveLenderBankId.test.ts`
(2 cases — no-pick fallback, picked-lender resolution).

## 2. Brokerage's personal financial statement (PFS) capture has been silently failing since it shipped

**The problem, confirmed against the live database, not just the code:**
`borrower_applicant_financials.applicant_id` had a foreign key to
`borrower_applicants(id)` — a legacy magic-link-portal table
(`docs/migrations/002_borrower_portal_foundation.sql`) that Brokerage code
never writes to. But the only actual writer of this table
(`src/lib/brokerage/propagateBorrowerFacts.ts`, called from the concierge
and voice routes on every Brokerage deal) and the only reader
(`form413/inputBuilder.ts`, used by the form-generation pipeline this
session just built in T7) both always used `applicant_id =
ownership_entities.id` instead — a completely different, unrelated ID
space from `borrower_applicants.id`.

Live-database confirmation: 15 `ownership_entities` rows exist, but **0**
rows exist in either `borrower_applicant_financials` or
`borrower_applicants` — despite `propagateBorrowerFacts.ts`'s PFS writer
being live code, called every time a borrower gives Buddy financial
information in conversation. Every insert has been failing the FK
constraint since this shipped; the error is caught and pushed into a
`errors[]` array by design (`propagateBorrowerFacts.ts`'s "every field
write is independent and non-fatal" pattern) — never surfaced to a human,
so nobody would have seen this fail.

**Second-order impact, also live and also fixed:**
`src/lib/brokerage/buildSealedSnapshot.ts` — the function that assembles
what lenders actually see when a package is sealed and listed — queried
`borrower_applicant_financials.eq("deal_id", dealId).maybeSingle()`. That
table has no `deal_id` column at all (it's keyed by `applicant_id`, one row
per owner, not one per deal); the query would error at the PostgREST layer
and silently resolve to `null`, meaning **every sealed Brokerage listing's
`fico_score`/`liquid_assets`/`net_worth`/`industry_experience_years` has
always been null** in the lender-facing Key Facts Sheet, regardless of
what the borrower actually provided.

**The fix:**
- Migration `supabase/migrations/20260715_fix_borrower_applicant_financials_fk.sql`
  — drops and re-adds the FK to point at `ownership_entities(id)` instead
  of `borrower_applicants(id)`, matching what every real caller already
  assumes. Applied live and verified against `pg_constraint`. Zero data
  loss — both tables had zero rows, so there was nothing to migrate, only
  a constraint to correct.
- `buildSealedSnapshot.ts` — replaced the bogus `deal_id` filter with a
  proper two-step resolution: find the deal's primary individual owner
  (largest `ownership_pct`, same "primary owner" convention
  `form155/inputBuilder.ts` already uses elsewhere), then look up that
  owner's `borrower_applicant_financials` row by `applicant_id`.

No test file existed for `buildSealedSnapshot.ts` before or after this
change (it has nine parallel Supabase queries feeding a large assembly
function — a full stub would be a substantial undertaking on its own, not
scoped into this bug-fix pass); verified via `tsc` + the full suite instead,
same as the rest of this fix.

## Verification

`npx tsc -p tsconfig.json --noEmit` clean. Full `pnpm test:unit`: 11,589
passed, 0 failed (up from 11,587 — 2 new tests for
`resolveEffectiveLenderBankId`). Live FK constraint verified via
`pg_constraint` post-migration.
