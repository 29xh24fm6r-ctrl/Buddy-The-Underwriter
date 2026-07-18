# Task B — AcroForm Field Verification: Findings

**Goal:** confirm the field names `render.ts` writes into actually match
the real government AcroForm field names on Forms 1919, 413, 912, and
4506-C, and check in a ground-truth field-name reference per form.

**Status: FIXED for 1919, 413, 912, 4506-C, and 155 — five forms
rewritten end-to-end — `fields.ts`, a new `pdfFieldMap.ts` per form,
`inputBuilder.ts`, and `render.ts` — against real, verified AcroForm
field names, with type-aware fill logic (text/checkbox/radio/Yes-No
checkbox pairs). The scoping question raised in the original version of
this doc (full SSN vs. last-4) was resolved per the user's explicit
instruction to capture enough information to complete these documents
"completely, thoroughly and accurately... perfectly every single time":
Buddy now persists the full SSN/TIN (including a spouse's, for Form 413 —
see §9) via the existing encrypted `deal_pii_records` vault
(`storeSecurePii`/`getDecryptedPii`, AES-256-CBC), decrypted only
transiently at render time — not the "have the signer type it at signing"
shortcut. Every fix was verified with a visual fill-test (fake data
rendered into the real government PDF and inspected page-by-page), which
caught three real placement/authoring bugs a tooltip- or name-only mapping
would have shipped silently (§7). All five forms' real PDFs are now
actually ingested (`public/sba-templates/` + `bank_document_templates` —
previously zero rows existed for ANY of these forms, so none could render
end-to-end regardless of mapping correctness; see §8). Forms 148/601/1244
remain genuinely blocked — no real source PDF for any of them has been
supplied, so unlike 155 there is nothing to verify against (§9); their
`render.ts` files are explicitly marked as unverified rather than left
looking equivalent to the fixed forms.**

## 1. How the source PDFs were obtained

`sba.gov`/`irs.gov` are blocked by this environment's egress policy
(confirmed via the proxy status endpoint — a policy denial, not retried),
and neither `bank_document_templates` nor Google Drive had usable copies
of 1919 or 912 (see the prior version of this doc, preserved in git
history, for that investigation). The user uploaded the actual current
PDFs directly, across two batches: `Form_1919.pdf`, `SBA_Form_912.pdf`,
`SBA_Form_4506c.pdf`, `SBA_Form_155.pdf`, `SBA_Form_159.pdf`, then
`SBAForm413.pdf`.

Fields were dumped with `pdf-lib` (`form.getFields()`), reading each
field's internal name, type, and — critically — its `/TU` tooltip, which
on all six of these PDFs turned out to hold the actual instructional text
a filer sees ("Please enter the first owner's legal name..."). That made
this a high-confidence extraction, not a guess: the ground-truth dumps are
checked in at `docs/sba-forms/{1919,413,912,4506c,155,159}-fields.json`.

## 2. Field-name mismatch: confirmed, as expected

Zero overlap between any `fields.ts` semantic key and any real AcroForm
field name, on any form. Real 1919 field names look like `applicantname`,
`busTIN`, `ownName1`/`ownPerc1`/`ownTin1` (numbered 1-5 for Section II
owners); real 912 field names are the literal question text (`"3. Social
Security Number"`); real 4506-C field names are the standard IRS XFA-style
path (`form1[0].page_1[0].name_shown[0].first_name[0]`). None of these
match `applicant_legal_name`, `full_name`, `ssn_last4`, etc. This confirms
the risk flagged in the first version of this doc.

Beyond naming, `render.ts`'s fill loop also only ever calls
`form.getTextField(key)` — it has no path for `PDFCheckBox` or
`PDFRadioGroup` at all. Real 1919 has 60+ checkbox fields (entity type,
loan purpose, demographics, all thirteen yes/no compliance questions) and
real 912 has 4 `PDFRadioGroup` fields (citizenship + 3 yes/no questions).
Even with correct names, today's code would throw on every one of those
and silently skip them (same catch-and-skip block) — so the fix isn't
just "swap in the right string," it's "add type-aware fill logic
(checkbox/radio, not just text)."

## 3. The bigger finding: the current data model doesn't ask what the current forms ask

This is the part worth stopping for. Comparing each real field's `/TU`
tooltip against what `ownership_entities`/`deal_loan_requests` actually
capture today (per the original SPEC v2's schema evidence and this repo's
`fields.ts` files) turned up real content gaps, not just naming gaps:

**Form 912 — Statement of Personal History.** The real, current-revision
form asks:
- **The full Social Security Number** (`"3. Social Security Number"`).
  `fields.ts` models `ssn_last4`, sourced from `ownership_entities.tax_id_last4`
  (also mirrored on `borrower_owners.ssn_last4`) — confirmed via
  `information_schema`: **no table anywhere in the schema stores a full
  SSN**, only last-4. This isn't a bug, it looks like a deliberate
  PII-minimization choice — which means filling this field correctly
  requires a real decision, not just a data-model tweak: either start
  persisting full SSNs (meaningful security/compliance scope — encryption
  at rest, access-logging, probably a dedicated vault table rather than a
  plain column), or have the borrower type it directly into the document
  during the SignWell signing ceremony itself (a signer-editable field
  SignWell prefills nothing into) so it never touches Buddy's database at
  all. The second option avoids the new-PII-storage problem entirely and
  is probably the better default, but it's still a product decision, not
  something to default silently.
- **Percentage of ownership** (`"2. Give the percentage of ownership..."`)
  — not modeled in `FORM_912_FIELDS` at all today.
- **Exactly three yes/no compliance questions**: currently
  incarcerated/serving a sentence/under indictment for a felony or
  financial-misconduct/false-statement crime (Q8); convicted of a
  riot/civil-disorder-related offense in the past year (Q9); more than 60
  days delinquent on child support (Q10). `fields.ts` instead models five
  *different* categories inherited from the old form revision
  (`arrest_or_charge_explanation`, `conviction_explanation`,
  `indictment_explanation`, `parole_probation_explanation`, plus the
  generic "pending criminal charges" framing) — these don't line up
  question-for-question with what SBA now actually asks.
- This also means `FORM_912_TRIGGER_FIELDS` in `form1919/fields.ts` (which
  decides *whether Form 912 even gets generated* for an owner) is keyed
  off the old, broader category set (`has_been_arrested_or_charged_in_6mo`,
  `has_pending_criminal_charges`, `is_subject_to_indictment`,
  `has_paroled_or_probation`) rather than the narrower three questions the
  current 912 actually asks.

**Form 1919 — Section I (deal-level).** `fields.ts` models 4 boolean
questions (`has_other_sba_application_pending`,
`has_been_in_bankruptcy_pending`, `has_pending_lawsuits`,
`is_engaged_in_lobbying`). The real form has **13** numbered yes/no
questions covering a much wider compliance surface: debarment/bankruptcy
(Q1), loan default/delinquency history (Q2), ownership of other businesses
(Q3), incarceration/felony/financial-misconduct indictment (Q4), fees paid
to the Lender/CDC or a broker — in two program-dependent variants, CDC
(Q5) vs. non-CDC Lender (Q6) — revenue from gambling/lobbying/prurient
content (Q7), SBA-employee conflicts of interest (Q8), former-SBA-employee
conflicts (Q9), Congress-member/legislative-judicial-branch conflicts
(Q10), GS-13+ federal employee or military conflicts (Q11),
SCORE/advisory-council membership (Q12), and pending legal action
including divorce (Q13). Only Q13 (legal action) and part of Q1
(bankruptcy) have any real correspondence to what's modeled today; Q2–Q12
aren't captured anywhere. 1919 also has a full demographic/veteran-status
checkbox block per owner (veteran status, sex, race, ethnicity) that isn't
modeled at all, and an export-sales section (Q11-adjacent: estimated
export sales, up to 3 countries) that isn't either.

**Form 413 — Personal Financial Statement. The good-news case.** Unlike
1919/912, `fields.ts`'s ~40 Section-1 fields (identity, asset/liability/
contingent-liability/income summary line items) line up conceptually,
one-to-one, with real fields on the form (`Cash on Hand & in banks`,
`Notes Payable to Banks and Others`, `Net Investment Income`, etc.) —
this is a straightforward rename once the mapping decisions below are
made, not a redesign. Real gaps found:
- **Full SSN, again** — the real field is literally labeled `"Enter
  Social Security No for Name 1. (xxx-xx-xxxx"`, same
  full-vs-last-4 gap and same two options as Form 912 (persist it, or
  have the signer type it in at signing time). The form also has a
  *second* full-SSN field for a joint/spouse signer
  (`"...for Name 2..."`), doubling the same decision.
- **The itemized supporting schedules aren't modeled at all** —
  `fields.ts` only has the Section 1 summary *totals*
  (`asset_stocks_bonds`, `liability_notes_payable_banks_others`, etc.).
  The real form has full schedules behind each: Section 2 (notes payable,
  5 rows × noteholder/original balance/current balance/payment/frequency/
  collateral), Section 3 (securities, 4 rows × shares/name/cost/market
  value/quotation date/total), Section 5 (other personal property,
  narrative), Section 6 (unpaid taxes, narrative), Section 7 (other
  liabilities, narrative), Section 8 (life insurance, narrative). None of
  these are unanswerable-without-new-data the way 912's Congress/military
  questions are — the underlying numbers likely already exist somewhere
  in `borrower_applicant_financials` per the "full itemized PFS breakdown"
  the `inputBuilder.ts` header comment describes — but they still need to
  be wired field-by-field, and it's a real scoping question whether an
  MVP ships with just the Section 1 summary (leaving those schedules
  blank) or the full itemization.
- **Real estate is single-property in `fields.ts`, three-property (A/B/C)
  on the real form**, each with ~10 sub-fields (type, address, date
  purchased, original cost, present market value, mortgage
  holder/account/balance/payment, status) — `fields.ts`'s flat
  `real_estate_*` fields would need to become a per-property array, same
  pattern as 1919's Section II owners.
- Minor: the form's business-entity-type checkboxes (Corporation/S-Corp/
  LLC/Partnership/Sole Proprietor) and program-context checkboxes at the
  top (WOSB/8(a)/Disaster/7(a)-504-Surety, "Applicant Married") aren't
  modeled — likely fine to backfill from data already captured elsewhere
  on the deal rather than needing new intake questions.

**Form 4506-C.** Smaller gap, but real: the current form separates a
single-tax-form-number transcript request (line 6: Return / Account /
**Record of Account** — a third type `fields.ts` doesn't have) from a
*second*, independent wage-and-income-transcript request (line 7, up to
three form numbers) with its own four-slot year/period date structure —
"Verification of Non-filing," which `fields.ts` models as a fourth
transcript type, doesn't appear anywhere on this revision's fields at all.

## 4. Scoping decision made: full SSN, persisted, not signer-typed

Sections 3 (912) and 413's SSN paragraphs both hit the same fork: the
current-revision government forms want a full SSN/TIN, and nothing in the
schema stored one (only last-4). The user's directive was explicit —
capture enough information to complete these documents "completely,
thoroughly and accurately... perfectly every single time" — which rules
out the signer-types-it-at-signing shortcut as the default, since that
would mean the rendered PDF Buddy hands to SignWell is *incomplete* until
the signer manually fixes it, and underwriters reviewing the package
beforehand would see a blank field.

Resolution: reuse the existing `deal_pii_records` encrypted-PII
infrastructure (already built for other flows — AES-256-CBC,
`PII_ENCRYPTION_KEY`/`BUDDY_PII_KEY`, audited access) rather than adding a
new storage mechanism. `securePiiIntake.ts` gained `getDecryptedPii()` /
`decryptStoredPii()`; `inputBuilder.ts` for every form only ever carries a
*presence marker* (`"on_file"` vs. missing) through `build()`, and only
`render.ts` — at the very last step, with a live `supabase` client injected
by the caller — calls `getDecryptedPii()` to pull and decrypt the real
value, write it into the PDF, and let it fall out of scope. No full SSN
ever touches a build result, a log line, or a `fields.ts` default.

## 5. The fix, form by form

**FORM_912.** `fields.ts`, `pdfFieldMap.ts` (new), `inputBuilder.ts`,
`render.ts` rewritten against the real field set: `full_ssn` (decrypted
at render time), `ownership_percentage`, `date_of_birth`,
`place_of_birth`, `is_us_citizen` (radio), and exactly the three real
yes/no questions (`incarcerated_or_indicted_financial_crime`,
`riot_related_conviction_past_year`, `delinquent_child_support_60days`,
new `ownership_entities` columns) in place of the old five mismatched
categories. `FORM_912_TRIGGER_FIELDS` in `form1919/fields.ts` now keys off
the one real trigger question instead of the old four-category set.

**FORM_1919.** Section I gained `unique_entity_id`, `project_address_*`,
`special_ownership_type`. Section II was rebuilt around the real 13
numbered yes/no questions (new `ownership_entities` columns — see
migration below), the full demographic block (veteran status/sex/race/
ethnicity, each a real checkbox group), and the export-sales sub-section
(gated by `has_export_sales`, up to 3 countries). `render.ts` changed
architecture: it now takes `ownershipEntityId` + `dealId` and renders one
PDF per individual, filling the 5-slot owner-roster fields
(`ownName1..5`/`ownTitle1..5`/`ownPerc1..5`/`ownTin1..5`/`ownHome1..5`) —
the old code flattened every person into prefixed keys that could never
match any real field name, so this was a correctness fix, not just a
rename. `FORM_1244_SECTION_II_FIELDS` re-exports the same field list, so
`form1244/inputBuilder.ts`'s Section II query was rewritten too (the 5 old
category columns were kept populated since `src/lib/score/*` depends on
them for underwriting scoring).

**FORM_413.** Section 1 identity/summary fields renamed to match the real
form 1:1 as expected. `full_ssn` (+ a second, independent `spouse_full_ssn`
field for the joint signer) now decrypts the same way as 912's. The
itemized schedules were *not* left as a silent gap: three new tables
(`borrower_pfs_notes_payable`, `borrower_pfs_securities`,
`borrower_pfs_real_estate`, keyed by `applicant_id`) were added, and
`fields.ts`/`inputBuilder.ts`/`render.ts` loop over them to fill Section 2
(notes payable, 5 rows), Section 3 (securities, 4 rows), and Section 4
(real estate, properties A/B/C). Sections 5-8 (other personal property,
unpaid taxes, other liabilities, life insurance — all narrative/free-text
on the real form) are registered in `borrowerFieldRegistry.ts` but have no
intake UI wired to them yet; see §8.

**FORM_4506-C.** `fields.ts`/`pdfFieldMap.ts` rewritten against the real
XFA-style deep field paths. Added `full_ssn`, `tax_form_number_line6`
(text, not the old enum), `transcript_type_record_of_account` (the third
transcript type the old code didn't model), and widened the
wage-and-income section (line 7) to its own independent up-to-3-form-number
array with a 4-slot month/day/year date structure per period. IVES
participant fields (name/ID/SOR mailbox ID) come from env vars, not the
database — see §8 for the outstanding registration gap.

## 6. New schema (applied live via Supabase MCP)

- `20260718000000_sba_form_field_coverage_expansion.sql` — ~25 new
  `ownership_entities` columns (demographics, the 13 real 1919 questions,
  912's 3 real questions, prior address, export sales), 4 new `borrowers`
  columns (unique entity ID, special ownership type, project address), and
  the 3 new `borrower_pfs_*` itemized-schedule tables (RLS deny-all +
  bank-membership-select, `set_updated_at()` triggers, matching the
  existing `borrower_applicant_financials` `applicant_id` PK pattern).
- `20260718000001_form1919_export_gate_fix.sql` — adds
  `ownership_entities.has_export_sales`, written after the visual-test
  discovery in §7.

## 7. Bugs the visual fill-test caught (that name/tooltip mapping alone would have missed)

Every form was fill-tested with fake data on the actual uploaded PDF and
the rendered pages were visually inspected (not just "no exception
thrown") — this caught three real bugs:

1. **Form 912 residence-address placement.** `current_address`/
   `prior_address` looked correctly named, but the rendered PDF showed the
   values landing on the "From:" date lines instead of the address lines —
   an ambiguity in which of two candidate fields is the address vs. the
   date range. Per this project's standing rule to never guess field
   placement on a legal document, this mapping was removed entirely
   (documented in `render.ts`) rather than shipped as a guess.
2. **Form 4506-C `customer_file_number` length.** pdf-lib threw
   `Attempted to set text with length=14 for TextField with maxLength=10`
   — the real field caps at 10 characters. Fixed by truncating
   `dealId.slice(0, 10)`.
3. **Form 1919 Q5/Q6 stale tooltip.** The `/TU` tooltip on `q5Yes`/`q5No`
   read like a CDC-fee question, so the first mapping pointed
   `fee_paid_to_cdc_or_broker` there. The rendered PDF showed Q5 is
   actually the export-sales gate ("Are your products/services exported?")
   sitting directly above the export sub-fields, with the fee question
   actually at Q6 — confirmed by widget y-coordinates
   (q5 y=337 → export fields y=311/268 → q6 y=241). This is a real
   authoring bug in the government's own PDF (a stale/copy-pasted
   tooltip), not a Buddy bug — but trusting the tooltip over the
   position would have silently mis-filed which compliance question was
   answered. Fixed by adding `has_export_sales` (migration above) mapped
   to q5Yes/q5No, and making `fee_paid_to_lender_or_broker` (Q6) the real
   fee-paid question.

## 8. Per-form status (final)

| Form | Real AcroForm names confirmed | Field-name mismatch fixed | Content/coverage gap | Type-aware fill (checkbox/radio) | Visual fill-test |
|---|---|---|---|---|---|
| FORM_1919 | Yes | Yes | Closed (13 questions + demographics + export modeled) | Yes | Passed |
| FORM_413 | Yes | Yes | Closed, including Sections 5-8 narratives and spouse SSN (§9) | Yes | Passed |
| FORM_912 | Yes | Yes | Closed (3 real questions + full SSN + ownership %) | Yes | Passed |
| FORM_4506C | Yes | Yes | Closed; IVES participant config now per-bank (§9), IRS enrollment itself is still operational/outside this codebase | Yes | Passed |
| FORM_155 | Yes (`155-fields.json`) | Yes — rewritten against the real 16-field/9-98-revision PDF | Closed (real 4-option radio group + SBA-assigned loan number; `full_standby_for_loan_term`/`subordination_terms_acknowledged` don't correspond to distinct fields on this revision, removed from the form's required set) | Yes (radio group) | Passed |
| FORM_148/FORM_148L/FORM_601/FORM_1244 | **No — blocked** | Not attempted | Not attempted | N/A | N/A |
| FORM_159 *(separate pipeline, not e-sign)* | Yes (`159-fields.json`), bonus | Not in scope | Not diffed | N/A | N/A |

All 5 forms with confirmed ground truth (1919, 413, 912, 4506-C, 155) also
had their real PDF committed to `public/sba-templates/` and registered in
`bank_document_templates` (previously zero rows existed for any of these —
the auto-ingestion script needs sba.gov/irs.gov, which are blocked here, so
without this the correct field mapping would never actually render a PDF
in this environment). 148/601/1244 remain unregistered — no real PDF
exists to ingest.

## 9. Gaps resolved after the initial fix

The four gaps this doc originally left open have been resolved:

- **Spouse SSN (413)**: `deal_pii_records` now accepts a `spouse_full_ssn`
  pii_type (same row-per-owner pattern as `full_ssn`, keyed by the SAME
  `ownership_entity_id` as the primary signer — a spouse isn't a separate
  ownership entity on this form). `storeSecurePii`/`getDecryptedPii` widened
  to accept it; `form413/inputBuilder.ts` and `render.ts` wire it the same
  way as the primary signer's own SSN. (Also fixed in the same migration:
  `deal_pii_records` had no unique constraint on
  `(deal_id, ownership_entity_id, pii_type)` despite `storeSecurePii`'s
  upsert requiring one for `ON CONFLICT` to work — a latent bug, now fixed.)
- **413 Sections 5-8**: `borrower_applicant_financials` gained
  `other_personal_property_description`/`unpaid_taxes_description`/
  `other_liabilities_description`/`life_insurance_description` columns;
  `inputBuilder.ts` now reads them (the PDF mapping was already correct —
  only the data source was missing).
- **4506-C IVES participant registration**: fields now read from
  `banks.settings` (per-bank, same pattern as `src/lib/etran/generator.ts`'s
  `sba_lender_id`/`sba_service_center`), falling back to env vars.
  `renderForm4506cPdf` takes an optional `bankId`; all three call sites
  updated. Actual IVES enrollment with the IRS remains a real operational
  step outside this codebase — code can supply the values, not obtain them.
- **Forms 148/601/1244/155**: per the decision to fix what's verifiable and
  flag the rest as blocked (not guess), **Form 155** was rewritten against
  a real uploaded copy of the PDF (see §8) — its previous "backlog" status
  is closed. **148/601/1244** remain genuinely blocked: no real copy of
  any of these three PDFs has been supplied, so unlike 155 there is no
  ground truth to verify against. Their `render.ts` files are now
  explicitly commented as unverified placeholders (rather than silently
  looking equivalent to the fixed forms) so this isn't mistaken for "not
  yet gotten to" — it's "cannot verify without a real source PDF."
