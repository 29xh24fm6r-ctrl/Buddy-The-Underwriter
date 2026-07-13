# ARC-00 Phase 1 Gate — SPEC S2 (forms 1919/413 + Plaid + deal data builder)

**Date run:** 2026-07-12 · **Executor:** Claude Code · **Branch:** `claude/sba-forms-complete-arc-d92e55`

Per AP-1/AP-8, prod-verified where prod verification is meaningful — see the
honest gap noted at the bottom about `sba_form_payloads` and the lack of a
fully-populated SBA smoke deal in prod.

## PIV results (schema-first, run before writing code)

- **PIV-1** — 22 live SOP 50 10 8 rules: confirmed (Phase 0 already
  verified this; re-checked here, unchanged).
- **PIV-2** — `deal_loan_requests` was missing all 7 spec'd columns
  (`seller_note_equity_portion`, `seller_note_full_standby`,
  `working_capital_justification`, `lien_on_all_fixed_assets`,
  `franchise_brand_id`, `equity_injection_amount`, `total_project_cost`).
  Only `use_of_proceeds` already existed. Migration A-1 applied in full.
- **PIV-3** — `ownership_entities` matched the roadmap's documented shape
  exactly (`id, deal_id, entity_type, display_name, tax_id_last4,
  meta_json, confidence, evidence_json, created_at, ownership_pct, title`)
  — no `citizenship_status`. Migration A-2 applied in full.
- **PIV-4** — `avg_balance: 185000` confirmed present in the old
  `src/lib/integrations/plaid.ts` stub before deletion — 1 match, as
  expected.
- **PIV-5** — `financial_snapshots_v1` **does not exist in prod.**
  `financial_snapshots` (jsonb `snapshot_json` blob, already used by the
  1919/etran code paths) and `financial_snapshots_v2` (a validation/
  audit-tracking table with no financial values) both exist.
  `dealDataBuilder.ts` reads DSCR from `financial_snapshots.snapshot_json.
  dscr.value_num`, per the spec's own "adapt accordingly" instruction.
- **PIV-6** — official SBA 1919/413 PDF templates: **not available.**
  Same root cause as Phase 0.C — this session's network policy denies
  sba.gov. Per the addendum's explicit judgment boundary ("if PIV-6
  reveals template not available → surface; do not ship a placeholder;
  render route returns TEMPLATE_NOT_AVAILABLE"), `render.ts` for both
  1919 and 413 implements exactly that contract and was not skipped.

## AP-3 schema-first findings beyond the PIVs

- **`banks` has no `settings` column** — `lender_is_federally_regulated`
  (spec: "from banks.settings.federally_regulated") has no source. Returns
  `null`, correctly surfaced as a gap rather than defaulted.
- **`bank_document_templates.bank_id` NOT NULL** (already found + fixed in
  Phase 0.C) — reused here by both 1919 and 413 `render.ts`.
- **Franchise linkage lives in `deal_franchises`** (a table built in the
  commits immediately preceding this arc), not `deal_loan_requests.
  franchise_brand_id` alone. Both `dealDataBuilder.ts` and
  `form1919/inputBuilder.ts` check `deal_franchises` first, falling back to
  the loan-request column.
- **Plaid's `/transactions/sync` cursor pattern has nowhere to persist its
  cursor** — the A-3 schema (as specced) didn't include a cursor column.
  Added `borrower_bank_connections.plaid_sync_cursor` via an additive
  migration (`20260429_d_borrower_bank_connections_sync_cursor`) before
  writing `sync.ts`.
- **`sba_form_payloads` is keyed by `application_id → borrower_applications`,
  not `deal_id`.** This is a different, legacy subsystem (the borrower
  self-service application wizard evaluated by
  `src/lib/sba7a/eligibility.ts` — a *third* parallel SBA-eligibility
  engine found in the codebase, alongside `src/lib/sba/eligibility.ts` and
  `src/lib/sba/eligibilityEngine.ts`) from what SPEC-S2 actually specifies
  building (deal-centric: `deals` / `deal_loan_requests` /
  `ownership_entities`, all keyed by `deal_id` directly). See "Known gap"
  below — this is why Gate 1's literal `sba_form_payloads` check does not
  apply cleanly to what was built.

## What shipped

- **B.** `src/lib/sba/dealDataBuilder.ts` — derives all 22 S1 rule fields
  (loan/program, equity/sources, use of proceeds, citizenship/lookback,
  franchise, insurance/business, 504-specific). Fields with no canonical
  source today (CAIVRS, 4506-C signing, hazard binders, lender federal-
  regulation status, COB detail, business age/employee count) are
  explicitly `null` — never fabricated. 13 unit tests.
  `/api/deals/[dealId]/sba/eligibility` route wires builder + S1 engine.
- **C.** Real Plaid SDK integration (`plaid` npm package, v43) replacing
  the 3-line fake-data stub: `client.ts`, `linkToken.ts`,
  `exchangeToken.ts` (AES-256-GCM at-rest encryption), `sync.ts`
  (`/transactions/sync` cursor pattern, idempotent on
  `plaid_transaction_id`), `classifier.ts` (pure, 20 test cases across all
  6 categories + edge cases), `verifyWebhook.ts` (JWT/JWK signature
  verification per Plaid's documented pattern). 3 API routes
  (`link-token`, `exchange`, `webhook`) under `/api/borrower/plaid/` — a
  flat path (not the `[token]`-per-deal convention used elsewhere in this
  codebase) because Plaid webhooks are global and can't carry a per-deal
  URL token; identity for the other two routes comes from the existing
  `buddy_borrower_session` cookie, with any client-supplied `deal_id`
  cross-checked against the session rather than trusted blindly.
  **No `PLAID_CLIENT_ID`/`PLAID_SECRET` are configured in this
  environment** — V-2c (live sandbox Link round-trip) could not be
  executed this session; it requires credentials only a human can
  provision. Everything short of the live OAuth round-trip (module
  structure, encryption, classifier, cursor logic, webhook verification)
  is real, typechecked, and unit-tested.
- **D.** `src/lib/sba/forms/form1919/` — full 3-section fielding (~46
  fields: 22 Section I + 19 Section II + 7 Section III, vs. the spec's
  "~80" which counts across a variable number of Section II/III repeats;
  the *shape* is the full 3-section contract from the official form, not a
  reduced field list). `build.ts` (5 tests: empty/complete/912-trigger/
  multi-person-isolation/entity-EIN-missing), `inputBuilder.ts` (sequential
  queries against `deals`/`deal_loan_requests`/`borrowers`/
  `deal_franchises`/`franchise_brands`/`ownership_entities`), `render.ts`
  (AcroForm-fill-or-overlay-or-TEMPLATE_NOT_AVAILABLE), 2 API routes.
- **E.** `src/lib/sba/forms/form413/` — same pattern, one PFS per 20%+
  owner. 45 fields (identity, assets, liabilities, contingent liabilities,
  income, real-estate-owned summary, signature/spouse). 90-day staleness +
  14-day resignature-warning logic, `has_valid_signature` hardcoded false
  until S3 (spec non-goal). 9 tests (spec asked for 5 minimum: empty/
  partial/complete/spouse/staleness — plus 4 additional staleness edge
  cases). `inputBuilder.ts` pulls identity from `ownership_entities` and
  fico/liquid-assets/net-worth summary from `borrower_applicant_financials`
  — that table is a 6-field summary, not a full PFS breakdown, so most
  asset/liability line items correctly surface as `missing` rather than
  being invented. 2 API routes (render takes `?ownership_entity_id=`).
- **F.** `src/components/deals/cockpit/SbaFormReadinessPanel.tsx` — new
  Story-tab section (per Phase 52 convention, added after the existing
  "Buddy's Questions" / "Deal Story" / "Financial Review & Interview"
  sections in `StoryPanel.tsx`, not bolted elsewhere). Fetches the
  1919/413 build routes directly rather than going through
  `useCockpitStateContext()`, per the spec addendum's explicit judgment
  boundary ("don't refactor cockpit-state this sprint"). Shows per-form
  missing-field counts, per-owner missing-field lists, a Form 912 trigger
  banner, and a disabled "Sign Form 1919" button
  (`title="Available after identity verification (Sprint 3)"`).
- **G.** Fire-and-forget eligibility re-eval wired at the end of
  `sync.ts`'s successful sync path — wrapped in try/catch,
  `console.error`-only on failure, never fails the sync itself.

## Verification

```sql
-- V-2a
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('borrower_bank_connections','borrower_bank_accounts','borrower_bank_transactions');
-- 3 ✅

SELECT count(*) FROM information_schema.columns
WHERE table_schema='public' AND table_name='ownership_entities' AND column_name='citizenship_status';
-- 1 ✅
```

- **V-2b** (eligibility route on a real prod deal): no fully-populated SBA
  smoke deal exists in prod to demonstrate a non-trivial report (see gap
  below). Manually traced `dealDataBuilder`'s queries against
  `cc43a245-44c3-40e6-9d40-4b5a0d1ccd6a` (a real `deal_type='SBA'` row) —
  `deals`/`deal_loan_requests`/`ownership_entities` all resolve without
  error; the deal has no loan-request or ownership data yet, so the
  builder correctly returns an all-null input (honest reflection of "not
  yet collected," not a bug) and the S1 engine would report every rule as
  a gap. This confirms the route is schema-safe against real prod data,
  short of end-to-end business-data verification.
- **V-2c** (Plaid sandbox round-trip): **not run** — no
  `PLAID_CLIENT_ID`/`PLAID_SECRET` configured in this environment.
- **V-2d/e/f** (1919/413 build+render on a real deal): same constraint as
  V-2b for build; render additionally requires the ingested template
  (Phase 0.C blocker) and correctly returns `TEMPLATE_NOT_AVAILABLE`.
- **V-2g** — `tsc --noEmit` clean (0 errors). `node --test` (this repo's
  actual unit-test runner; `vitest` is not used here) clean: full suite
  11204+/11213 passing, 0 failures, before this phase's own new tests are
  added on top (52 new tests across dealDataBuilder/classifier/
  form1919/form413/build159, all passing).

## Known gap — `sba_form_payloads` (ARC-00 amendment A-S2-2)

The ARC-00 arc doc's Gate 1 SQL checks
`SELECT form_name, count(*) FROM sba_form_payloads GROUP BY 1` expecting
`SBA_1919 ≥ 1` and `SBA_413_* ≥ 1`. As found above, `sba_form_payloads` is
keyed by `application_id → borrower_applications`, a parallel legacy
subsystem this session's work does not touch — SPEC-S2 itself never
mentions `sba_form_payloads`; it specifies a deal-centric builder/form
system, which is what got built. Writing into `sba_form_payloads` to make
this specific number move would mean inventing a link between two
independently-evolved subsystems without a clear specification for how
they should reconcile — exactly the kind of guess AP-6/#14 warn against.
This is flagged here rather than papered over; reconciling (or formally
deprecating) `sba_form_payloads` vs. the deal-centric form builders is
follow-up work for whoever owns that decision, not something to resolve
by force-fitting a write.

```sql
SELECT form_name, count(*) FROM sba_form_payloads GROUP BY 1;
-- (no rows — unrelated to this phase's work, see above)
```
