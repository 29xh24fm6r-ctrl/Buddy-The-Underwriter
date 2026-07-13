# ARC-00 Phase 4 Gate — NEW SPEC S6 (the 504 track)

**Date run:** 2026-07-12 · **Executor:** Claude Code · **Branch:** `claude/sba-forms-complete-arc-d92e55`

No spec file existed for this phase — built directly from the arc doc's
Phase 4 section, as instructed.

## AP-3 schema-first findings

- `deal_loan_requests` had `total_project_cost`/`injection_amount`/
  `injection_source`/`property_address_json` already, but **nothing
  representing the 504 50/40/10 structure** (third-party lender / CDC
  debenture / borrower contribution amounts) or the 504-specific
  certification fields (occupancy %, job creation/retention, public
  policy goal, debt-refi). Confirmed via `information_schema` before
  writing any code. Additive migration
  `20260711_a_deal_loan_requests_504_project_cost.sql` adds 11 nullable
  columns; applied to prod cleanly, no drift.
- `sba_package_templates`/`sba_package_items` already existed (Phase 3
  wired them for 7(a)) — `SBA_504_BASE` was a straightforward second seed
  row following the exact same pattern as `SBA_7A_BASE`, no schema changes
  needed there.

## What shipped

- **Migration `20260711_a_...`** — 11 additive columns on
  `deal_loan_requests` for the 504 project-cost split + certification
  fields.
- **Migration `20260711_b_...`** — seeds `SBA_504_BASE` package template +
  5 items (`SBA_1244` required, `SBA_413` required, `SBA_912` conditional,
  `IRS_4506C` required, `SBA_159` required — per the spec's literal item
  list, note `SBA_159` is required here vs. conditional on `SBA_7A_BASE`,
  which is followed as-specified even though it doesn't match the 7(a)
  seed's convention). Both applied to prod.
- **`src/lib/sba/forms/form1244/`** — same 5-file module pattern as every
  other form in this arc (fields → build → inputBuilder → render →
  buildWithSignature). Section II/III field sets are imported directly
  from `form1919/fields.ts` rather than duplicated, per the spec's own
  "same certification sections as 1919" instruction — this also means a
  schema/wording fix to one program's personal-history questions
  automatically applies to both. 4 build tests.
- **Route** — `GET /api/deals/[dealId]/sba/forms/1244/[action]`
  (`action ∈ {build, render}`), one consolidated file instead of the
  `/1244/build` + `/1244/render` two-file convention every earlier phase
  used. This is a deliberate departure, not an inconsistency: the arc's
  own Drift Log (Phase 2 and 3) flagged the route/page slot budget as an
  escalating risk and explicitly recommended "design all new routes in
  Phases 3-6 using the catch-all pattern from the start." Phase 3 didn't
  apply it (shipped before the recommendation was acted on); Phase 4 does.
  URL shape is unchanged (`/sba/forms/1244/build`, `/sba/forms/1244/render`)
  — this is purely a file-count optimization, not an API change.
- **`sbaFormDispatch.ts`** — `SBA_1244` added as a 7th dispatched
  template code, same pattern as Phase 3's 6.
- **A-S4-3 parity** — `form912/inputBuilder.ts`'s `buildForm912Input` now
  evaluates the Form 912 trigger against *both* Form 1919's and Form
  1244's Section II answers (previously 1919 only), so a 504 deal's
  criminal-history disclosures correctly produce a Form 912 too.
- **`dealDataBuilder.ts`** — `creates_or_retains_jobs`,
  `meets_public_policy_goal`, `owner_occupancy_percentage` (previously
  hardcoded `null` since Phase 1, when the fields were first added to the
  type in anticipation of this phase) now read from the new
  `deal_loan_requests` columns.
- 5 new dealDataBuilder tests, 1 new dispatcher test (`SBA_1244`).

## Verification

```sql
-- Gate 4
SELECT pt.code, count(pi.*) FROM sba_package_templates pt
JOIN sba_package_items pi ON pi.package_template_id = pt.id GROUP BY 1;
-- SBA_7A_BASE  | 6  ✅
-- SBA_504_BASE | 5  ✅ (both present with full item sets)
```

- **Smoke 504 deal (package run generates filled 1244 + 413 + 4506-C +
  159 PDFs; signed via DocuSeal)** — **not run live**: same environmental
  gaps as every prior phase (no smoke deal in prod, no DocuSeal
  deployment, no official 1244 template ingested — sba.gov blocked). Every
  code path is unit-tested against mocked/empty data instead
  (`sbaFormDispatch.test.ts`'s new `SBA_1244` case confirms the dispatcher
  correctly reaches `buildForm1244WithSignature`/`renderForm1244Pdf` and
  fails closed with `form_incomplete` rather than fabricating output).
- `tsc --noEmit` clean. Targeted test run (form1244, form912, sbaFormDispatch,
  dealDataBuilder): 37/37 passing.
- Route budget: 1957/2048 (91 slots headroom to the 1987 error threshold) —
  the consolidated `[action]` route added only 2 slots instead of 4.

## Known gaps — environmental, not code (unchanged posture)

Same four as Phase 3 (no vendor credentials for credit bureau/CAIVRS/IRS,
no DocuSeal deployment, no legal review of consent text, no smoke deal in
prod) plus: no official SBA Form 1244 template ingested (irs.gov/sba.gov
blocked). All require human provisioning outside this session's reach.

## Carried-forward risk

Route budget: 1957/2048, 91 slots to the warning-adjacent error threshold.
Phases 5 (closing forms: 148/148L/601/722 + 10-tab assembly) and 6 (E-Tran)
remain. Recommend continuing the consolidated-route pattern established
here for all remaining new routes in this arc.
