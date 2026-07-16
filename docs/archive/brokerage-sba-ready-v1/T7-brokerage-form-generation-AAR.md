# Ticket 2 follow-up — Brokerage per-owner SBA form generation

**Date:** 2026-07-15
**Status:** orchestration + trigger shipped. Actual PDF rendering is blocked
on official SBA/IRS templates not being ingested in this environment — a
pre-existing, tenant-independent blocker, not something this pass
introduced.

## Why this exists

Flagged as a gap during Ticket 2 (`docs/archive/brokerage-sba-ready-v1/T5-ticket2-identity-esign-AAR.md`):
Brokerage had no path to generate the actual filled SBA forms (1919, 413,
912, 4506-C, etc.) that feed the lender-facing 10-tab package, unlike the
Underwriter tenant's ARC-00 `sbaFormDispatch.ts` pipeline.

## A nuance found while building this (worth recording)

Digging in to build this surfaced something the earlier T5 AAR didn't
distinguish clearly: **the DocuSeal e-signature ceremony does not actually
depend on this form-generation pipeline.** `requestSignature()`
(`src/lib/esign/docuseal/service.ts`) creates a submission against a
pre-configured DocuSeal template (`resolveTemplateId()`, env var
`DOCUSEAL_TEMPLATE_<FORM_CODE>`) — a vendor-side artifact set up once by an
admin, entirely separate from `sbaFormDispatch.ts`'s filled reference PDF.
So the e-sign UI's real blocker is (a) DocuSeal templates being configured
per form code and (b) knowing which forms apply to which owner — not
literally waiting on this pipeline. This pipeline instead produces the
**filled, unsigned reference copy** used for the eventual lender-facing
10-tab package assembly (`assembleTenTabPackage`) — genuinely useful in its
own right, and exactly what was asked for, just worth being precise that
it's not a hard blocking dependency of the signing UI the way the earlier
AAR implied.

## What shipped

1. **`src/lib/brokerage/borrowerFormsOrchestration.ts`** — new orchestration
   layer, four functions, all pure `(dealId, sb)`:
   - `resolveSbaPackageTemplate(productType)` — maps `deals.product_type`
     (`SBA_7A`/`SBA_504`/`SBA_EXPRESS`/null) to the matching
     `sba_package_templates.code` + `product` pair the existing
     `resolvePackageItems`/`prepareSbaPackage` expect (`SBA_7A_BASE`/"7a"
     or `SBA_504_BASE`/"504" — confirmed these are the only two rows in
     `sba_package_templates` via a live query). Brokerage is 7(a)-only in
     practice today, so anything unrecognized defaults to 7(a) rather than
     failing closed with no package at all.
   - `prepareBrokerageSbaForms` — idempotent wrapper around the existing
     `prepareSbaPackage()`: if a `sba_package_runs` row already exists for
     the deal, returns it instead of creating a duplicate (a repeated
     borrower click or retry must not spawn a second, divergent run — the
     Underwriter-tenant banker action doesn't need this guard since a
     banker console has more deliberate, single-shot state, but a
     borrower-facing trigger does).
   - `getBrokerageFormsStatus` — reads the deal's current package run +
     item statuses (prepared/generated/failed per template code).
   - `generateBrokerageForms` — renders one item (`onlyItemId`) or every
     ungenerated item, reusing the existing `generatePdfForFillRun()`
     unchanged; mirrors `generatePackageRunPdfAction`'s per-item try/catch-
     and-record-failure loop in `/api/deals/[dealId]/sba/route.ts`.
   - `assembleBrokerageFormsPackage` — merges all generated items via the
     existing `assembleTenTabPackage()` unchanged.
   - All four resolve "the deal's package run" server-side (most recent by
     `created_at`) rather than trusting a client-supplied `packageRunId` —
     a Brokerage borrower has no reason to know that id, and deriving it
     server-side closes off the cross-deal-guessing risk the other
     Brokerage routes already guard against (same invariant as the
     ownership-entity checks in Ticket 2's kyc/esign routes).
2. **Route wiring** — added four new actions (`forms-status` GET,
   `prepare-forms`/`generate-forms`/`assemble-forms` POST) to the existing
   `src/app/api/brokerage/deals/[dealId]/borrower-actions/[action]/route.ts`
   dispatcher, **renamed from `identity/[action]`** to `borrower-actions/
   [action]` since it now covers more than identity. Added to the existing
   file rather than a new route file deliberately — one more route.ts
   would have tipped the slot count from 1902 back to 1904/1904
   (`routeConsolidationGuard.test.ts`'s warning threshold), the same
   problem Ticket 2 hit and solved the same way.
3. **Auto-trigger at pick time** — `src/app/api/brokerage/deals/[dealId]/marketplace/pick/route.ts`
   now calls `prepareBrokerageSbaForms` (best-effort, non-fatal, same
   try/catch pattern already used there for lender-notification emails)
   right after a successful pick. Rationale: Ticket 2's documented default
   is that e-signature happens after pick, so the forms it will eventually
   need should already exist by then rather than being built lazily the
   first time someone opens a signing screen. This only *prepares* the
   package run + item rows — it does not attempt to *render* PDFs
   automatically, since rendering can fail today (see blocker below) and a
   failed render shouldn't be silently swallowed into a background hook.
4. Tests: `src/lib/brokerage/__tests__/borrowerFormsOrchestration.test.ts`,
   10 cases covering the product-type mapping, idempotent prepare, status
   read, generate (including the not-found and missing-fill-run-id
   failure paths), and assemble's not-yet-prepared path.

## Environmental blocker (pre-existing, not introduced here)

`public/sba-templates/` does not exist in this repository/environment.
Every `renderXPdf()` call — Underwriter or Brokerage, doesn't matter — will
return `TEMPLATE_NOT_AVAILABLE` until `scripts/ingest-sba-templates.ts` is
run somewhere with real network access to sba.gov/irs.gov to fetch and
commit the official fillable PDFs, and upsert the corresponding
`bank_document_templates` rows (`bank_id IS NULL` — confirmed the template
row itself is tenant-agnostic by design, so nothing Brokerage-specific is
needed there once ingestion happens). This is the same class of blocker as
ARC-00 Phase 0's own documented network-access gap, not something this
Brokerage integration pass introduced or can route around.

## Two things flagged, not fixed (product calls, not bugs)

- **Form 413 (PFS)** reads `borrower_applicant_financials` keyed by
  `applicant_id = owner.id`. Whether Brokerage's borrower-facing intake
  flow actually writes to that table wasn't confirmed in this pass — worth
  checking before assuming a live Brokerage deal's Form 413 renders with
  real data rather than gaps.
- **4506-C and Form 155** both resolve their `recipient_name`/`lender_name`
  field from `banks.name` (looked up by the deal's own `bank_id`). For a
  Brokerage deal, that resolves to "Buddy Brokerage" — the brokerage
  itself, not the eventual originating lender the form is really addressed
  to. Not a code bug (the field does exactly what it's documented to do),
  but likely the wrong value for a form headed to a real lender once one
  is picked; worth a product decision on whether to thread the picked
  lender's bank name through instead.

## Verification

`npx tsc -p tsconfig.json --noEmit` clean. Full `pnpm test:unit`: 11,587
passed, 0 failed (up from 11,577 — 10 new tests). Route count unchanged at
765 files (`routeConsolidationGuard.test.ts` passes at 1902/1904 — actions
were added to the existing dispatcher, not a new route file).
