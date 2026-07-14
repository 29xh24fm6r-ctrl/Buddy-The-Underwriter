# Follow-up ticket — Principal Residence Certification

**Filed:** 2026-07-14, out of SPEC-BROKERAGE-SBA-READY-V1 Ticket 0 (see `docs/archive/brokerage-sba-ready-v1/T0-findings.md`, item 2).
**Priority: P0.** Confirmed by product (2026-07-14) as the single highest-priority follow-up out of all of Ticket 0's findings — a live regulatory gap with a passed effective date, not a hypothetical one.
**Depends on:** none blocking. Independent of Tickets 2–8.

---

## Context

SBA Procedural Notice 5000-876626 ("Revised Applicant Ownership, Citizenship, and Residency Requirements for 7(a) and 504 Loans"), effective **2026-03-01**, has two distinct requirements:

1. Lawful permanent residents (LPRs) are categorically ineligible to own any part of an SBA applicant.
2. **Separately**, every owner — including US citizens and nationals — must have their **principal residence** in the United States, its territories, or possessions. "Principal Residence is defined by IRS Publication 523," added to SOP 50 10 8's Appendix 3 as a definition distinct from citizenship status.

Requirement 1 was fixed in Ticket 1 (`src/lib/sba/dealDataBuilder.ts`'s `ELIGIBLE_CITIZENSHIP_STATUSES` no longer includes `"lawful_permanent_resident"`). **Requirement 2 is still an open gap**: there is no field, certification, or eligibility check anywhere in this codebase that captures or gates on principal residence. A US citizen whose principal residence is outside the US/its territories currently resolves as fully eligible — incorrectly.

Confirmed during T0 by reading `dealDataBuilder.ts`'s full citizenship-eligibility block (`allOwnersCitizenshipEligible`, ~lines 308-324): it only ever reads `citizenship_status`. `home_address_street/city/state/zip` exist on `ownership_entities` and in `BORROWER_FIELD_REGISTRY`, but they're read only by the form1919/413/912/4506-C input builders for mailing-address purposes — never as an eligibility signal.

## Scope

1. **Schema:** additive migration adding a `principal_residence_in_us boolean` (or equivalent) column to `ownership_entities`. Verify against `information_schema.columns` before writing, per this repo's standing rule. RLS: match the existing deny-by-default + bank-scoped select pattern already on this table.
2. **Registry:** add the new field to `BORROWER_FIELD_REGISTRY` (`src/lib/sba/forms/borrowerFieldRegistry.ts`) as an owner-scope entry, `requiredForForms: ["1919", "1244", "912"]` (matching `citizenship_status`'s current `appliesToForms`/`requiredForForms`).
3. **Capture path:** decide whether this is conversationally capturable (a direct yes/no question the concierge can ask alongside citizenship status) or needs the structured-fallback-capture step Ticket 3 is building — likely the former, since it's a single boolean, not a multi-field breakdown. If Ticket 3 hasn't landed yet when this is picked up, build the conversational capture only and let Ticket 3 pick up the fallback path later.
4. **Eligibility gate:** update `dealDataBuilder.ts`'s citizenship-eligibility block so `allOwnersCitizenshipEligible` is `false` for any individual owner whose `citizenship_status` is eligible but `principal_residence_in_us` is explicitly `false`, and `null` (not computed / fails closed) when the field is unset for an otherwise-eligible owner — same null-handling convention the block already uses for missing `citizenship_status`.
5. **Certification surface:** once Ticket 2 (identity/e-sign) lands, add an explicit attestation statement to the e-signature ceremony ("I certify my principal residence, as defined by IRS Publication 523, is in the United States, its territories, or possessions") rather than relying solely on a silently-captured boolean — this is a certification the borrower is making, not just a data field.

## Verification

- Migration applied additively; `information_schema.columns` confirms the new column and its RLS policy.
- Synthetic deal: US-citizen owner, `principal_residence_in_us = false` → `allOwnersCitizenshipEligible` resolves `false` (today it would incorrectly resolve `true`).
- Synthetic deal: US-citizen owner, `principal_residence_in_us` unset → resolves `null` (fails closed, not fabricated).
- Synthetic deal: all owners US-based and eligible → resolves `true`, unchanged from today.
- Existing `dealDataBuilder.test.ts` citizenship-eligibility cases still pass; new cases added for the three scenarios above.
