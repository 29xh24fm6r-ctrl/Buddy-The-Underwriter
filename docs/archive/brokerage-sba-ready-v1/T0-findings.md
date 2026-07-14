# T0 Findings — SPEC-BROKERAGE-SBA-READY-V1

**Date:** 2026-07-14
**Status:** ✅ Items 1, 2, 3, 5 resolved with citations to live code and current SBA guidance. Item 4 routed to a person, not engineering, per the spec's own instruction.

---

## Item 1 — Equity injection floor: 20% in code is WRONG. Correct figure is 10%.

**Verdict: the spec's suspicion was correct — `newBusinessProtocol.ts` is out of date. Fixed as part of T1.**

Current SBA guidance (SOP 50 10 8, effective June 1, 2025, technical updates May 29, 2025 — still in force as of this writing) sets equity injection at **10%**, not 20%, for the categories that trigger it:

> "SBA 7(a) loans for both startup ventures and changes in business ownership require at least 10 percent equity injection from the buyer." — [Starfield & Smith, "Best Practices: A Review of Equity Injection Requirements Under SOP 50 10 8"](https://starfieldsmith.com/2025/05/best-practices-a-review-of-equity-injection-requirements-under-sop-50-10-8/)

Two distinct age thresholds exist in the current SOP and the code had conflated them:

- **"New business"** (generating revenue ≤ 24 months) — triggers the **projected DSCR** requirement (1.25x vs. 1.10x historical). `newBusinessProtocol.ts`'s existing `isNewBusiness` (< 24 months) boundary and its 1.25x/1.10x DSCR split are **correct** and match current SOP.
- **"Start-up business"** (generating revenue ≤ 12 months) **and complete changes of ownership** — these are the two categories that actually trigger the minimum equity injection floor, and that floor is **10%**, not 20%.

I found no citation anywhere in current SOP 50 10 8 commentary for a 20% equity-injection floor tied to business age. The only "20%" figure that shows up in SOP 50 10 8 discussion is unrelated: equity investors holding **under 20% ownership** are exempt from the personal-guarantee requirement in complete-change-of-ownership deals. It's plausible the 20% in `newBusinessProtocol.ts` originated from someone conflating that ownership threshold with the equity-injection percentage — but I can't confirm the origin, only that it doesn't match any current equity-injection rule.

**Fix applied in T1:** `EQUITY_FLOOR_NEW_BUSINESS` changed from `0.2` to `0.1` in `src/lib/sba/newBusinessProtocol.ts`, with narrative/comment updates. Note this makes the "new business" and "existing business" floors numerically identical (both 10%) — that's expected, not a leftover bug: the code doesn't currently distinguish "start-up" (≤12mo) from "early-stage" (12–24mo) for equity-floor purposes, and 10% is the correct floor for the true start-up subset and for changes of ownership. Introducing a finer-grained start-up/early-stage split for the equity floor specifically (as opposed to the existing STARTUP/EARLY_STAGE risk-multiplier labels, which serve a different purpose and are unaffected) is left as a follow-up if underwriting wants a stricter distinction — it was not required to close this discrepancy.

Sources: [Starfield & Smith](https://starfieldsmith.com/2025/05/best-practices-a-review-of-equity-injection-requirements-under-sop-50-10-8/), [Windsor Advantage](https://windsoradvantage.com/news/updated-sba-equity-injection-rules-what-you-need-to-know-about-sop-50-10-8), [Whiteford Taylor Preston](https://www.whitefordlaw.com/news-events/client-alert-sba-issues-sop-50-10-8-key-changes-impacting-sba-7a-lending).

---

## Item 2 — Citizenship/residency: found a bigger, live compliance gap than the spec asked about

**Verdict: the spec asked "is a Principal Residence certification field missing?" — yes, it is. But research surfaced something more urgent: the eligibility code's `ELIGIBLE_CITIZENSHIP_STATUSES` set is actively wrong under a rule that has been in force since March 1, 2026 — over four months before today's date (2026-07-14).**

**SBA Procedural Notice 5000-876626** ("Revised Applicant Ownership, Citizenship, and Residency Requirements for 7(a) and 504 Loans"), effective **March 1, 2026**, rescinded the prior notice (5000-872050) and imposed a materially stricter rule:

> "Effective March 1, 2026, all direct and indirect owners of a small business applicant must be U.S. citizens or U.S. nationals whose principal residence is in the United States, its territories or possessions." — [NAGGL summary](https://www.naggl.org/sba-issues-notice-making-major-revisions-to-sop-50-10-8-citizenship-and-residency-requirements/)

Critically: **lawful permanent residents (LPRs / green card holders) are no longer eligible at all**, full stop — not "eligible if principal residence is in the US," just categorically excluded:

> "Lawful Permanent Residents (LPRs)... including individuals with permanent Unconditional LPR status, and Conditional LPR status are now ineligible for SBA 7(a) loan ownership." — [NerdWallet](https://www.nerdwallet.com/business/loans/news/sba-loan-green-card-holders), corroborated by [The Business Journal](https://thebusinessjournal.com/sba-bars-green-card-holders-from-business-loan-ownership-starting-march-1/) and [Malescu Law](https://malesculaw.com/green-card-holders-barred-from-sba-loans-starting-march-1-2026/)

The rescinded prior rule (5000-872050) had allowed LPRs whose principal residence was outside the US, and even up to 5% foreign-national ownership. That prior, more permissive rule is exactly what's still encoded in this repo today:

```ts
// src/lib/sba/dealDataBuilder.ts:104-108
const ELIGIBLE_CITIZENSHIP_STATUSES = new Set([
  "us_citizen",
  "us_national",
  "lawful_permanent_resident",   // ← no longer eligible as of 2026-03-01
]);
```

This feeds `allOwnersCitizenshipEligible` (`dealDataBuilder.ts:315-324`), which is the eligibility signal read by the policy pack (`src/lib/policy/packs/sba_preapproval.ts:40` references `borrower.citizenship_status`). **Today, a deal with an LPR owner is being told it is citizenship-eligible when current binding SBA policy says it is not.** This is a live false-negative on an eligibility gate, not a missing nice-to-have field.

**On the "Principal Residence" question specifically:** the notice adds "Principal Residence is defined by IRS Publication 523" to Appendix 3, as a definition distinct from citizenship status — it matters even for citizens/nationals (a US citizen whose principal residence is abroad is also ineligible). The registry (`borrowerFieldRegistry.ts`) has `citizenship_status` and `alien_registration_number` but **no field capturing principal residence as a distinct fact/certification** — `home_address_*` fields exist but they're used for form-mailing-address purposes in the 1919/413/912/4506-C input builders, not read anywhere as a residence-eligibility signal. I confirmed this by reading `dealDataBuilder.ts`'s full citizenship-eligibility block (lines 308-324) — it only ever reads `citizenship_status`, never a home-address or residence field.

**What I fixed now vs. what's a follow-up:**
- **Fixed now (T1, low-risk, high-confidence):** removed `"lawful_permanent_resident"` from `ELIGIBLE_CITIZENSHIP_STATUSES`. This only makes the gate *more* conservative (fails closed more often) — it cannot newly permit anything that was previously blocked, so the change carries no risk of approving an ineligible deal; the only behavior change is that deals with an LPR owner now correctly show `allOwnersCitizenshipEligible: false` instead of `true`. The DB check constraint and the `is_lpr` field on Forms 1919/1244 are untouched — LPR remains a valid *status to record*, it's just no longer a valid *eligibility* answer. Citation-backed, unambiguous, effective date already 4+ months past.
- **Not built in this pass — recommend as a dedicated follow-up ticket:** a `principal_residence_in_us`-style field/certification (new column + registry entry + concierge/structured-capture question + eligibility-rule update to also gate on it for citizens/nationals, not just LPRs). This is a schema change + capture-flow change, which is exactly the shape of work Ticket 3 (structured fallback capture) already exists to scope and build — bolting it onto T1 would blur T1's actual deliverable (the new-business protocol wiring). Flagging it here so it isn't lost: **this is the single highest-priority follow-up out of all of Ticket 0's findings**, because it's a live regulatory gap with a passed effective date, not a hypothetical one.

Sources: [SBA Procedural Notice 5000-876626](https://www.sba.gov/document/procedural-notice-5000-876626-revised-applicant-ownership-citizenship-residency-requirements-7a-504-loans), [NAGGL](https://www.naggl.org/sba-issues-notice-making-major-revisions-to-sop-50-10-8-citizenship-and-residency-requirements/), [NerdWallet](https://www.nerdwallet.com/business/loans/news/sba-loan-green-card-holders), [The Business Journal](https://thebusinessjournal.com/sba-bars-green-card-holders-from-business-loan-ownership-starting-march-1/).

---

## Item 3 — Business debt schedule: confirmed missing from Brokerage; also confirmed missing from *every* production path, not just Brokerage

**Verdict: the spec's guess ("may be document-extraction-driven rather than conversational") was half right and half wrong — it exists, but it's Plaid-transaction-driven, not OCR-driven, and it currently has zero production callers anywhere in the codebase, Brokerage or Underwriter.**

`src/lib/financialFacts/debtScheduleAutoBuilder.ts` exports a pure function `buildDebtSchedule(transactions: BorrowerBankTransactionLike[])` that infers existing debt obligations (mortgage/credit-card/MCA/etc.) from **Plaid bank-transaction data**, per `specs/sba-30min-package/SPEC-S4-credit-pull-and-irs.md`. It's fully unit-tested (6 cases in `debtScheduleAutoBuilder.test.ts`) but I found **no caller of `buildDebtSchedule` anywhere outside its own test file** — not in a route, not in a job processor, not in the Brokerage concierge, not in any Underwriter cockpit flow. It's a finished, tested, unwired function.

Separately, `src/app/api/deals/[dealId]/existing-debt/route.ts` provides GET/POST against a `deal_existing_debt_schedule` table — but this route is gated by `ensureDealBankAccess`, i.e. it's a **banker-side manual-entry API** for the Underwriter cockpit, not something a Brokerage borrower can reach.

`BORROWER_FIELD_REGISTRY` has no `requiredForForms` entries for existing business debt at all (confirmed via grep — no `existing_debt`/`debt_schedule` keys in the registry), and the concierge extraction prompt (`borrowerConversation.ts`) doesn't ask about it either.

**Net finding: a Brokerage borrower today has zero path — conversational, Plaid, or manual — to get their existing business debt into the system.** SBA underwriting requires a full existing-debt schedule (not just the debt being refinanced) for DSCR/global-cash-flow purposes, so this is a real gap, exactly as the spec suspected, just not the mechanism it guessed. This becomes a genuine T3-adjacent ticket: wiring `buildDebtSchedule` to Brokerage's Plaid connection (if Brokerage even has Plaid wired — not confirmed in this pass, flagged for that follow-up ticket to verify) or adding a structured capture step, per Ticket 3's existing charter. Not built in this pass — it's its own ticket, not a T1 dependency.

---

## Item 4 — Form 159 applicability to Buddy's own role

Not an engineering question — routed to Matt/legal as the spec instructed. No code change, no further investigation performed here.

---

## Item 5 — Does the concierge actually populate the fact keys T1 depends on? Yes, confirmed.

**Verdict: T1's wiring will NOT silently no-op. `YEARS_IN_BUSINESS` is written by the concierge today.**

Traced the full path:
1. `borrowerConversation.ts:63` — the Gemini extraction prompt shared by text concierge and voice explicitly asks for `"years_in_business": number | null` on every turn.
2. `propagateBorrowerFacts.ts:176` — `factWrites` includes `{ key: "YEARS_IN_BUSINESS", value: num(businessFacts["years_in_business"]) }`, written into `deal_financial_facts` with `fact_type: "concierge"` whenever the extracted value is non-null and no document fact already exists for that key (document facts win per the file's own precedence comment).
3. `newBusinessProtocol.ts`'s `detectNewBusinessFromFacts()` reads `MONTHS_IN_BUSINESS` first, then falls back to `YEARS_IN_BUSINESS * 12`, then `BUSINESS_DATE_FORMED`. Only `YEARS_IN_BUSINESS` is ever written by the concierge (`MONTHS_IN_BUSINESS` and `BUSINESS_DATE_FORMED`/`DATE_FORMED` are not in `propagateBorrowerFacts.ts`'s `factWrites` list at all) — but that's fine, because the function's fallback chain already handles a years-only input correctly.
4. Column-name check: `deal_financial_facts` stores the numeric value in `fact_value_num` (confirmed in the table's own insert/select statements throughout `propagateBorrowerFacts.ts` and `score/inputs.ts`). `detectNewBusinessFromFacts` expects `{ fact_key, value_numeric, value_text }` — **the caller must map `fact_value_num` → `value_numeric` when building the facts array**, exactly as `score/inputs.ts:373-374` already does for the Buddy SBA Score's own risk-profile call. T1 reuses this exact mapping.

**Bonus finding, not asked for but directly relevant to T1's scope:** the Buddy SBA Score itself (`computeBuddySBAScore`, used live by the Brokerage concierge) is **already correctly wired** to new-business detection — `src/lib/sba/sbaRiskProfile.ts:169-177` already calls `detectNewBusinessFromFacts` + `assessNewBusinessRisk` and feeds the result into the risk profile's `business_age` factor (consumed by the score's `businessStrength` component). **The hardcoded `isNewBusiness: false` bug is isolated to `feasibilityEngine.ts:334`'s call into `analyzeFinancialViability()`** (the Feasibility Study PDF generator), which is a separate engine from the Buddy SBA Score. This narrows T1's actual blast radius: the Buddy SBA Score a lender/borrower sees for startup-risk purposes was never broken; only the feasibility-study narrative and its capitalization-adequacy sub-score were.

---

## Summary of code changes made as part of closing T0/T1

1. `src/lib/sba/newBusinessProtocol.ts` — `EQUITY_FLOOR_NEW_BUSINESS`: `0.2` → `0.1` (Item 1).
2. `src/lib/sba/dealDataBuilder.ts` — removed `"lawful_permanent_resident"` from `ELIGIBLE_CITIZENSHIP_STATUSES` (Item 2, live compliance fix).
3. `src/lib/feasibility/feasibilityEngine.ts` — wired real `detectNewBusinessFromFacts`/`assessNewBusinessRisk` in place of the hardcoded `isNewBusiness: false` (Item 5 confirms this is safe to do — the fact key is populated).

See `T1-AAR.md` for the full Ticket 1 writeup and verification evidence.
