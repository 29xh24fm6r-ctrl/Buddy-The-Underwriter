# AAR — Ticket 1 — Wire the New Business Protocol into Brokerage

**Date:** 2026-07-14
**Depends on:** T0-findings.md items 1 and 5 (both resolved — see that doc)
**Status:** ✅ Core wiring complete and verified. Items requiring a UI surface that doesn't exist yet (sealing gate / borrower-facing DSCR copy) were checked and found to have no current target to update — documented below, not invented.

---

## What was actually broken

`src/lib/feasibility/feasibilityEngine.ts:334` hardcoded `isNewBusiness: false` when calling `analyzeFinancialViability()` — every deal run through the Feasibility Study engine got established-business treatment (1.10x DSCR minimum, 10%-then-wrong-20% equity floor) regardless of the business's actual age. `src/lib/sba/newBusinessProtocol.ts` already implemented correct detection (`detectNewBusinessFromFacts`) and risk assessment (`assessNewBusinessRisk`) as pure functions — they just weren't called from this engine.

**Correction to the spec's framing, confirmed during T0:** the Buddy SBA Score itself (`computeBuddySBAScore`, what a lender/borrower actually sees) was **not** affected — `src/lib/sba/sbaRiskProfile.ts:169-177` already calls `detectNewBusinessFromFacts`/`assessNewBusinessRisk` for the score's `business_age` risk factor. The bug was isolated to the Feasibility Study PDF generator, a separate engine.

## Changes made

1. **`src/lib/sba/newBusinessProtocol.ts`** — `EQUITY_FLOOR_NEW_BUSINESS`: `0.2` → `0.1` (T0 item 1: current SOP 50 10 8 sets the floor at 10% for start-ups/changes-of-ownership, not 20%).

2. **`src/lib/sba/dealDataBuilder.ts`** — removed `"lawful_permanent_resident"` from `ELIGIBLE_CITIZENSHIP_STATUSES` (T0 item 2: SBA Procedural Notice 5000-876626, eff. 2026-03-01, makes LPRs categorically ineligible). Updated the corresponding test in `dealDataBuilder.test.ts` to assert the new, correct behavior instead of the old one.

3. **`src/lib/sba/sbaAssumptionCoach.ts`** — found a *second* hardcoded copy of the same wrong 20%-for-new-business equity rule (banker-facing coaching tips during assumption drafting). Fixed to match the corrected 10% floor, kept the `isNewBusiness`-aware message wording so a start-up borrower still understands why the floor applies to their deal specifically.

4. **`src/lib/feasibility/types.ts`** — added `equityInjectionFloor: number` and `projectedDscrThreshold: number` to `FinancialViabilityInput`. These are computed once by `assessNewBusinessRisk` and threaded in, rather than each consuming file re-deriving its own new-business/existing-business switch (this is exactly how the codebase ended up with three copies of the same wrong 20% figure — see T0-findings.md item 1).

5. **`src/lib/feasibility/financialViabilityAnalysis.ts`**:
   - Capitalization-adequacy check now reads `input.equityInjectionFloor` directly instead of recomputing `input.isNewBusiness ? 0.2 : 0.1` locally — removes the second hardcoded-20% copy the spec's Ticket 0 preamble warned this codebase tends to accumulate.
   - DSCR critical-flag threshold now reads `input.projectedDscrThreshold` instead of a bare hardcoded `1.25`. This is a real, in-scope correctness fix beyond what T0 flagged: previously an **established** business at, say, 1.15x DSCR (above its actual 1.10x SBA minimum) was incorrectly flagged "critical" against the new-business-only 1.25x standard. Now the critical flag and its message use whichever threshold actually applies to this deal.

6. **`src/lib/feasibility/feasibilityEngine.ts`**:
   - Queries `deal_financial_facts` for `MONTHS_IN_BUSINESS`/`YEARS_IN_BUSINESS`/`BUSINESS_DATE_FORMED`/`DATE_FORMED`, maps `fact_value_num`/`fact_value_text` → `value_numeric`/`value_text` (same mapping `score/inputs.ts` already uses for the Buddy SBA Score's own risk-profile call, so both engines agree).
   - Calls `detectNewBusinessFromFacts` then `assessNewBusinessRisk` (management experience taken as the max `yearsInIndustry` across the deal's management team, `hasBusinessPlan` approximated as "an SBA assumptions row exists for this deal").
   - Replaces the hardcoded `isNewBusiness: false` with the real `isNewBusiness`, and passes the real `equityInjectionFloor`/`projectedDscrThreshold` through.
   - Pushes `assessNewBusinessRisk`'s blockers (critical), warnings (warning), and narrative context (info, when `isNewBusiness`) into `financialViability.flags` — the same array `feasibilityNarrative.ts`'s Gemini prompt reads verbatim (`Flags: ${JSON.stringify(params.financialViability.flags)}`, line 145) — so a start-up's feasibility study narrative now actually explains the different treatment instead of silently applying different numbers underneath unchanged prose.

## Item 4 — sealing gate / borrower-facing copy: checked, nothing to update yet

Searched `src/components/brokerage/` and `src/app/(borrower)/` for any DSCR, equity-injection, or business-age copy surface a Brokerage borrower would actually see (sealing gate card, score explainer, etc.) — found none. Every DSCR/equity/business-age narrative component in this repo (`SBARiskProfilePanel`, `SBACCOReviewDashboard`, etc.) lives under `src/components/sba/` or `src/components/deals/cockpit/`, i.e. the Underwriter cockpit, not Brokerage. The new-business narrative currently surfaces into: (a) the Feasibility Study PDF (via the flags → Gemini narrative wiring above), which is a lender-facing document in the Trident bundle, and (b) the Buddy SBA Score's `business_age` narrative (already correct pre-T1), also lender-facing. There is no borrower-facing UI element in Brokerage today that states a DSCR requirement or equity floor to a borrower directly — so there was nothing concrete to update for this item. Recommend re-checking once Brokerage ships a borrower-facing score/requirements explainer.

## Verification

- `npx tsc -p tsconfig.json --noEmit` — clean.
- `pnpm test:unit` (full suite) — **11,545 passed, 0 failed, 9 skipped** (pre-existing skips, unrelated to this change).
- New tests:
  - `src/lib/sba/__tests__/newBusinessProtocol.test.ts` — 8 cases covering the corrected equity floor (0.1, not 0.2), the 1.25x/1.10x DSCR split, business-plan blockers, management-experience warnings, and the full `detectNewBusinessFromFacts` fallback chain (months → years×12 → date-formed → null). Runs under default `test:unit`.
  - `src/lib/feasibility/__tests__/financialViabilityAnalysis.test.ts` — 3 cases proving a DSCR of 1.15x is correctly *not* critical for an existing business but *is* critical for a new business at the same value, and that the equity floor comes from the passed-in `equityInjectionFloor` rather than a locally re-derived switch. **Quarantined** in `scripts/discover-tests.mjs` from the default `test:unit` run — `financialViabilityAnalysis.ts` has `import "server-only"`, which throws under plain `node --test` (same class of issue already quarantining `computeNextStep.test.ts`). Verified passing directly: `node --conditions=react-server --test --import tsx src/lib/feasibility/__tests__/financialViabilityAnalysis.test.ts` → 3/3 pass.
  - Updated `src/lib/sba/__tests__/dealDataBuilder.test.ts` — the LPR-eligibility test now asserts `false` (was `true`), plus a new us_citizen+us_national case for the still-eligible path.
- Synthetic end-to-end confirmation of a real startup deal through `computeBuddySBAScore` — **not done in this pass**. That's explicitly Ticket 8's job (needs a full synthetic deal seeded through the concierge → score → Trident pipeline) and the spec scopes it as a separate, later closing ticket, not part of T1's own verification bar. What T1's own bar asked for — `tsc` clean, new unit tests for both `isNewBusiness` paths — is met above.
