# AAR — Principal Residence certification (P0 follow-up) + Ticket 5 (Projections XLSX)

**Date:** 2026-07-15
**Status:** ✅ Both closed.

---

## Principal Residence certification

Closes `specs/follow-ups/SPEC-BROKERAGE-SBA-READY-V1-principal-residence-certification.md` — the highest-priority follow-up out of Ticket 0's findings, and the second half of SBA Procedural Notice 5000-876626 (eff. 2026-03-01) that Ticket 1 didn't reach (Ticket 1 fixed the LPR-ineligibility half only).

1. **Schema:** `ownership_entities.principal_residence_in_us boolean` (additive, nullable), applied live and verified via `information_schema.columns`. Migration: `supabase/migrations/20260714_ownership_entities_principal_residence.sql`.
2. **Registry:** new `BORROWER_FIELD_REGISTRY` entry, owner-scope, `requiredForForms: ["1919", "1244", "912"]` matching `citizenship_status`'s existing pattern. Because the concierge extraction prompt and `propagateBorrowerFacts.ts`'s write path are both driven generically off this registry (per their own design — "extending SBA form coverage means adding a registry row, not editing this file"), the entire conversational-capture-through-database-write pipeline now works with **zero additional code** — confirmed by reading `jsonTypeHint()`/`buildFillIfNullPatch()`, both of which already handle `type: "boolean"` generically.
3. **Eligibility gate:** `dealDataBuilder.ts`'s `allOwnersCitizenshipEligible` now resolves `false` when any citizenship-eligible owner has `principal_residence_in_us === false`, `null` (fails closed, never fabricated) when unset, `true` only when every owner clears both checks. 2 new tests, 1 existing test updated to seed the new field so it still asserts `true` correctly.
4. **finengine consistency:** `finengine/sba/eligibility.ts` (the not-yet-live future replacement, already touched during the earlier "verify finengine is the single source of truth" pass) gained the mirror field `ownersPrincipalResidenceInUs` and a corresponding `principal_residence` eligibility finding, so it doesn't regress the moment it goes live. 1 new test.
5. **Certification surface in the e-sign ceremony** — deferred, as the original ticket said it should be: it depends on Ticket 2 (identity/e-sign), which doesn't exist yet. Not attempted this pass.

## Ticket 5 — Projections XLSX real spreadsheet tables

The Sources & Uses and Balance Sheet tabs in `src/lib/brokerage/trident/projectionsXlsx.ts` dumped `JSON.stringify()` output into a single cell instead of real rows/columns/formulas — the document a picked lender opens, treated as an internal-artifact afterthought.

- **Sources & Uses tab:** real two-column table (Sources, then Uses), each with an Amount column and a formula-computed "% of Total" column; a `SUM()` formula for Total Sources and Total Uses (not pre-baked numbers); a balance-check row (`Sources − Uses`); and a full Equity Injection Check section (actual %, SOP minimum, a formula-computed PASS/FAIL, shortfall if any, seller-note-as-equity sub-check when applicable).
- **Balance Sheet tab:** real rows (17 line items: assets, liabilities, equity, and ratios) × columns (Base Year, Year 1-3), matching standard bank balance-sheet layout. Subtotals (Total Current Assets, Total Assets, Total Liabilities, Total Equity, Working Capital) and ratios (Current Ratio, Debt/Equity) are **live formulas** referencing the component line-item cells in that same year's column, not pre-computed static numbers — a banker editing an input cell would see every dependent subtotal/ratio recalculate, matching how a bank's own template behaves.
- Both tabs also got header styling (bold white-on-navy) and currency/percentage/ratio number formats, matching the existing polish on the Annual P&L / Sensitivity tabs.

**A real bug caught during verification, not just during writing:** the new code initially assumed `sourcesAndUses`/`balanceSheetProjections` always arrive in the real, well-formed shape. Running the full test suite surfaced `generateTridentBundle.test.ts`'s existing fixture, which — accurately reflecting production reality — seeds `sources_and_uses: {}` and `balance_sheet_projections: {}` (empty-object placeholders from `buddy_sba_packages` rows generated before those columns were populated, not `null` and not the real array/object shape). The original implementation crashed on this with a `TypeError` (`undefined is not iterable`), which would have taken down bundle generation for every deal carrying one of these legacy rows. Added explicit runtime shape validation (`Array.isArray()` checks, not just truthiness) so malformed/legacy data degrades to the same "not yet available" message a genuinely-null value gets, instead of crashing. Two new regression tests pin this exact scenario.

## Verification

- Migration applied live, confirmed via `information_schema.columns`.
- `npx tsc -p tsconfig.json --noEmit` — clean throughout.
- `pnpm test:unit` (full suite) — **11,561 passed, 0 failed, 9 skipped**, after catching and fixing the malformed-shape crash.
- New tests: `dealDataBuilder.test.ts` (+2), `phase5.test.ts` (+1), `projectionsXlsx.test.ts` (new file, 5 cases — valid workbook structure, real-table assertions with an explicit "no JSON dump anywhere" scan, formula-type assertions, graceful-degradation on both `null` and malformed `{}` inputs).
- **Visual check performed, per the ticket's own verification bar** ("a visual check, not just a passing test"): generated a real `.xlsx` from realistic synthetic deal data and delivered it to the user for inspection in Excel/Sheets, rather than only asserting programmatically that it *should* look right.
