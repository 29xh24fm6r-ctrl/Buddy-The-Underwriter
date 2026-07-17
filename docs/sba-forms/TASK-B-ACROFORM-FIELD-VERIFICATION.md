# Task B — AcroForm Field Verification: Findings

**Goal:** confirm the field names `render.ts` writes into actually match
the real government AcroForm field names on Forms 1919, 413, 912, and
4506-C, and check in a ground-truth field-name reference per form.

**Status: ground truth obtained and checked in for 1919, 912, 4506-C, plus
155 and 159 as a bonus (413 still pending — not yet supplied). The field
names are confirmed mismatched, as expected. But the more important
finding is bigger than a naming problem: for 1919 and 912, the actual
current-revision government forms ask for materially different — and in
912's case, narrower and stricter (full SSN, not last 4) — information
than what `fields.ts` currently models. This needs a scoping decision
before any fix is written, not just a rename.**

## 1. How the source PDFs were obtained

`sba.gov`/`irs.gov` are blocked by this environment's egress policy
(confirmed via the proxy status endpoint — a policy denial, not retried),
and neither `bank_document_templates` nor Google Drive had usable copies
of 1919 or 912 (see the prior version of this doc, preserved in git
history, for that investigation). The user uploaded the actual current
PDFs directly: `Form_1919.pdf`, `SBA_Form_912.pdf`, `SBA_Form_4506c.pdf`,
plus `SBA_Form_155.pdf` and `SBA_Form_159.pdf` as a bonus. `Form 413` is
still outstanding.

Fields were dumped with `pdf-lib` (`form.getFields()`), reading each
field's internal name, type, and — critically — its `/TU` tooltip, which
on all five of these PDFs turned out to hold the actual instructional text
a filer sees ("Please enter the first owner's legal name..."). That made
this a high-confidence extraction, not a guess: the ground-truth dumps are
checked in at `docs/sba-forms/{1919,912,4506c,155,159}-fields.json`.

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

**Form 4506-C.** Smaller gap, but real: the current form separates a
single-tax-form-number transcript request (line 6: Return / Account /
**Record of Account** — a third type `fields.ts` doesn't have) from a
*second*, independent wage-and-income-transcript request (line 7, up to
three form numbers) with its own four-slot year/period date structure —
"Verification of Non-filing," which `fields.ts` models as a fourth
transcript type, doesn't appear anywhere on this revision's fields at all.

## 4. Why I stopped here instead of writing the fix

Task B's own instruction is "mismatches get fixed as their own small PRs,"
which assumes the fix is a rename. It isn't, for 1919 and 912: filling in
the *correct* field names for compliance questions Buddy doesn't currently
collect from anyone would mean either (a) silently leaving those fields
blank on a legal document while claiming the render succeeded, or (b)
inventing default answers to questions like "are you a member of
Congress" or "are you delinquent on child support" — both are worse than
stopping to ask. Expanding the data model (new `ownership_entities`
columns, new conversational-intake questions, a full SSN column and the
handling that implies) is a real scoping decision, not something to fold
into a "verification" pass.

## 5. Per-form status (updated)

| Form | Real AcroForm names + tooltips confirmed | Field-name mismatch confirmed | Content/coverage gap found | Fixed |
|---|---|---|---|---|
| FORM_1919 | Yes (`1919-fields.json`) | Yes — 0% overlap | **Yes — Section I models 4 of 13 real questions; demographics + export section unmodeled** | No — needs scoping |
| FORM_912 | Yes (`912-fields.json`) | Yes — 0% overlap | **Yes — full SSN vs last-4, ownership %, and the 3 real questions vs. 5 modeled categories don't line up** | No — needs scoping |
| FORM_4506C | Yes (`4506c-fields.json`) | Yes — 0% overlap | Yes — record-of-account transcript type missing, wage/income section structure differs, non-filing verification doesn't exist on this revision | No — needs scoping |
| FORM_413 | Not yet — PDF not supplied | — | — | — |
| FORM_155 *(backlog per Task A)* | Yes (`155-fields.json`), bonus | Not diffed (not currently wired) | Not diffed | N/A |
| FORM_159 *(separate pipeline, not e-sign)* | Yes (`159-fields.json`), bonus | Not diffed (out of Task B's scope) | Not diffed | N/A |

No visual fill-test PDFs were generated yet — there's no correct field
mapping to test until the scoping question in section 4 is answered.

## 6. What's needed to close this out

Once Form 413 is supplied, it should get the same tooltip-based diff, and
plausibly has a similar naming-only gap. For 1919/912/4506-C, the
recommended path is:

1. Decide, per newly-found question/field, whether to (a) add the
   real column(s)/questions to collect it, (b) knowingly leave it blank
   on the rendered PDF with a visible flag (e.g. a `missing_from_intake`
   list surfaced in the build result, not silently), or (c) confirm one of
   the existing modeled fields is actually an acceptable proxy after all
   (only checked where a tooltip genuinely supports it — none found so
   far).
2. Once (1) is decided per field, write the real
   `SEMANTIC_KEY -> AcroForm field name (+ type)` map per form and update
   `render.ts` to dispatch by field type (text/checkbox/radio), not just
   `getTextField`.
3. Generate a filled test PDF with fake data and visually confirm.
