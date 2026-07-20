# Task A — Form Coverage Audit: Forms 148 / 601 / 1244 / 155

**Question:** are Forms 148, 601, 1244, 155 a live gap (blocking a real deal
today) or backlog (not yet needed)? Answered against live production data,
not assumption.

**Answer: backlog, all four.** No open deal currently needs any of them —
not because the forms are unbuilt, but because no open deal has reached the
data-collection depth where applicability could even be determined.

## 1. Implementation status

All four already have a complete `render.ts` implementation
(`src/lib/sba/forms/{form148,form601,form1244,form155}/render.ts`), each
following the same `fields.ts` → `inputBuilder.ts` → `build.ts` →
`render.ts` → `buildWithSignature.ts` shape as the four forms already wired
to the signing panel. All four are also already wired into
`src/lib/sba/package/sbaFormDispatch.ts` (`renderSbaPackageItem`), which
the compliance-package assembly flow uses — so they are reachable and
exercised today, just not from the e-signature flow.

They are **not** wired into:
- `src/lib/esign/signwell/resolveFilledPdfForSigning.ts` (only handles
  `FORM_1919` / `FORM_413` / `FORM_912` / `FORM_4506C`)
- `SbaSigningPanel.tsx`'s `TRACKED_FORMS` (same four)

So: implemented, not wired to signing — a small amount of remaining work
*if* needed, not a build-from-scratch gap.

## 2. Applicability logic already exists and is correct

`src/lib/sba/forms/applicability.ts`'s `computeApplicableForms()` already
encodes exactly when each form applies:

```
1244  — program === "504" (in place of 1919, which covers 7(a))
148, 4506c, 413 — hasIndividualOwner
155   — sellerNoteEquityPortion > 0
601   — constructionAmount > $10,000
```

This is real, tested logic (mirrors the per-form gating already
implemented in each form's own `inputBuilder.ts`), not something this
audit needed to build.

## 3. Live-deal check (queried directly, 2026-07-17)

12 deals are currently open (`stage` not in
`closed_won/closed_lost/withdrawn/declined`):

| Signal | Result |
|---|---|
| Deals with `sba_program` set on `deal_loan_requests` | **0 of 12** |
| Deals with `seller_note_equity_portion` set | **0 of 12** |
| Deals with `use_of_proceeds` set | **0 of 12** |
| Deals with `franchise_brand_id` set (any deal, not just open) | **0** |
| Open deals with any `ownership_entities` row at all | **0 of 12** (the only deal with owner data, 1 individual owner of 3, is in `stage = 'closed'` — excluded from "open") |
| `deal_required_documents` rows referencing 148/601/1244/155, or containing "guarantee"/"franchise"/"construction"/"civil rights" | **0** (table is empty — 0 rows total) |
| `deal_document_slots` rows for any SBA form (148/601/1244/155/1919/912/4506-C) | **0** (66 rows exist, all financial-statement collection: BTR/PTR/PFS/balance sheet/income statement/AR aging — no SBA-form slots at all) |

**Read:** the applicability inputs (`sba_program`, `seller_note_equity_portion`,
`franchise_brand_id`, ownership data) simply haven't been populated on any
currently-open deal. This isn't "these forms don't apply" — it's "no deal
has reached the point in the pipeline where applicability could be
evaluated." The 12 open deals are still in `intake`/`collecting`/
`underwriting` on basic financials, not yet at owner- or loan-structure
-level detail.

## 4. Correction to the spec's priority read

The follow-up spec guessed Form 148 (guarantees) and Form 1244 (franchise)
were the more likely live gaps. Data doesn't support prioritizing either
right now:

- **Form 1244** — zero deals have `franchise_brand_id` set, at all, ever.
  The franchise vertical has schema support (`franchise_brands`,
  `franchise_sba_directory_snapshots`, etc.) but no deal has been linked to
  a franchise brand yet.
- **Form 148** — would trigger once a deal has an individual owner
  (`hasIndividualOwner`), but 0 of 12 open deals have *any* owner rows
  populated yet, individual or otherwise.
- **Form 601 / Form 155** — genuinely long-tail as guessed (construction
  use-of-proceeds, 504 seller-note-equity), also unconfirmable today since
  `use_of_proceeds` / `seller_note_equity_portion` aren't populated on any
  open deal either.

## 5. Recommendation

Do not wire any of the four forms to the signing panel speculatively.
The real near-term gap is upstream of form selection: deals aren't yet
collecting `deal_loan_requests.sba_program` / `seller_note_equity_portion`
/ `use_of_proceeds` or `ownership_entities` rows during intake, so
`computeApplicableForms()` has nothing to evaluate against for any deal in
the current pipeline. Revisit this audit once a deal reaches that data
depth — at that point wiring the matching form(s) to
`resolveFilledPdfForSigning.ts` is the small, already-scoped remainder of
work described in section 1, not a new build.
