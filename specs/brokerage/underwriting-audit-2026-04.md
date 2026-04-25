# Underwriting Pipeline Audit — 2026-04

**Audit date:** 2026-04-25
**Test deal:** Samaritus Yacht Management (`0279ed32-c25c-4919-b231-5790050331dd`)
**Bank:** Old Glory Bank (`2cd15251-ecc7-452a-9a52-f8e88d23ff44`)
**Auditor:** Claude Code
**Branch:** `audit/underwriting-2026-04`
**Spec version:** v1.1

> **Note on deal_id correction.** Spec v1.1 listed `ffcc9733-f866-47fc-83f9-7c08403cea71` as the Samaritus deal_id. Live verification (2026-04-25) confirmed that ID does not exist in `deals`. Actual Samaritus deal_id is `0279ed32-c25c-4919-b231-5790050331dd` (`display_name = 'Samaritus Yacht Management'`, `bank_id = 2cd15251-...`, `stage = 'underwriting'`, created 2026-04-01). Spec's stale ID propagated from earlier sprint memory; flagged for memory-file correction outside the audit.

---

## Executive summary

The underwriting pipeline is structurally well-designed but operationally hollow in this DB instance. Of the 12 stages audited, **3 produced expected data** (assumptions, SBA package, financial facts), **8 produced no Samaritus data at all** (4 of those tables are globally empty), and **Stage 11's redactor correctly fail-safe-NO'd** when fed a fabricated-zeros snapshot.

Samaritus has data in only 4 of 12 audited tables: `deals`, `buddy_sba_assumptions`, `buddy_sba_packages`, `deal_financial_facts` (169 facts). The remaining 8 (`borrower_concierge_sessions`, `borrower_applications`, `borrower_applicants`, `borrower_applicant_financials`, `buddy_sba_scores`, `buddy_feasibility_studies`, `buddy_trident_bundles`, `buddy_validation_reports`) are empty for Samaritus and **5 of those 8 are globally empty** (`borrower_concierge_sessions`, `borrower_applications`, `buddy_sba_scores`, `buddy_trident_bundles`, `buddy_validation_reports`). The premise that "Samaritus has been carried through Sprints 0-5" does not match the data.

Despite the missing producers, the audit surfaced **substantive correctness issues** in the code paths that *do* run:

- The eligibility engine's UoP check **silently passes** when both `useOfProceeds` and `sourcesAndUses` are empty (Stage 7 P0 — `JSON.stringify({})` returns truthy `"{}"`).
- The deterministic personal-income extractor **wrote zero values for ADJUSTED_GROSS_INCOME, SCH_E_DEPRECIATION, and TOTAL_TAX** when its regex matched form *instruction text* rather than numeric values (Stage 8 P0 — 4 instances). Provenance is populated, but the snippet exposes the failure.
- The income-statement waterfall **does not internally reconcile**: sum of OpEx line items ≠ `TOTAL_OPERATING_EXPENSES`, and `revenue − COGS − OpEx ≠ OPERATING_INCOME` (Stage 8 P0 — extracted facts about the same statement are inconsistent).
- The package's `use_of_proceeds = []` and `sources_and_uses = {}` (Stage 7 P0 — the synthesized package has no UoP/S&U at all).
- `buildSealedSnapshot` **silently fabricates a snapshot with score=0, band="not_eligible", all components zero** when no score row exists (Stage 11 P0 — defensive defaults belong in the UI, not the snapshot assembler).
- Five values in `forRedactor.packageManifest` are **hardcoded literals** (page counts: 0, 0, 0; forms: ["1919","413","159"]; sourceDocumentsCount: 0). Even when a real bundle exists, these will be wrong.

**Severity counts: 13 P0, 18 P1, 7 P2.** Detailed list below.

The single bright spot: `redactForMarketplace` correctly threw on the fabricated snapshot (`band='not_eligible' not rate-card-eligible. Sealing gate must reject before this.`). That guard is the kind of correctness behavior the rest of the pipeline needs more of.

---

## Severity legend

- **P0** — blocks marketplace launch. Wrong outputs, missing required data, security gaps, fallback values claiming we have data we don't.
- **P1** — degrades quality but doesn't block launch. Weak narratives, missing provenance, edge case bugs.
- **P2** — nice-to-have improvements. Cosmetic, future hardening, low-frequency edge cases, legitimate-zero spot checks.

---

## Stage-by-stage findings

<!-- Each stage is appended as it completes. -->

### Stage 1 — Concierge intake → confirmed_facts

**Status:** **fail**

**Findings:**

- The `borrower_concierge_sessions` table contains **zero rows total** (across all deals, not just Samaritus). Verified via `SELECT COUNT(*) FROM borrower_concierge_sessions` → 0.
- Therefore Samaritus has no concierge session row to audit. No `confirmed_facts`, no `extracted_facts`, no `conversation_history`.
- The downstream loaders that the spec describes ("the score loader reading `confirmed_facts`") have no input to read from at all on this deal.
- **Two parallel `ALLOWED_FACT_KEYS` definitions exist with near-zero overlap:**
  - `src/app/api/brokerage/voice/[sessionId]/dispatch/route.ts:224-237` — **12 keys** (`business_type`, `naics_code`, `loan_amount_requested`, `loan_use`, `years_in_operation`, `annual_revenue`, `owner_industry_experience_years`, `business_location_city`, `business_location_state`, `existing_debt`, `equity_available`, `fico_estimate`)
  - `src/lib/interview/factKeys.ts:76-120` — **44 keys** (loan basics, business identity, contact, ownership, financials, SBA-specific, CRE-specific, equipment, demographics)
  - Shared keys between the two: only `naics_code` and `annual_revenue`. The two contracts are essentially disjoint.
- **Test-fixture name leak on the deal record itself.** Even before concierge intake, `deals` row shows `name = 'ChatGPT Fix 15'`, `borrower_name = 'ChatGPT Fix 15'`. Only `display_name = 'Samaritus Yacht Management'` carries the real label. Any borrower-facing surface reading `name` or `borrower_name` will display "ChatGPT Fix 15".
- **Spec doc rot:** spec referenced `last_activity_at` column on `borrower_concierge_sessions` (does not exist — closest is `updated_at`); spec asserted "21 `ALLOWED_FACT_KEYS`" (actual: 12 in dispatch route, 44 in interview factKeys, neither is 21).

**Issues filed:**

- **[P0] Concierge sessions table is globally empty.** Either (a) the dispatch route writes the session but rolls back / fails silently, (b) sessions are being deleted by a cleanup job, (c) the voice flow has not been exercised against this DB instance, or (d) Samaritus and all other deals have been carried through downstream stages without ever passing through concierge intake. Whichever it is, the upstream entry point of the underwriting pipeline has zero observable activity. **Recommended fix scope:** investigation ticket — spend half a day tracing the dispatch route writes, check for delete triggers, audit recent migrations on this table, and confirm whether the Sprint 2 voice flow ever produced a session in this environment. If sessions are written elsewhere (e.g., a different table after a refactor), update memory + spec to reflect the new source of truth. If they're being silently dropped, that's the actual P0 fix. (Single subtask, 4–8h investigation.)
- **[P1] Two parallel `ALLOWED_FACT_KEYS` with near-zero overlap (12 vs 44 keys, share only 2).** Different surfaces — voice dispatch vs. structured interview — have completely different fact contracts. A borrower who answers via voice provides up to 12 facts; the structured interview expects up to 44. There is no merge layer. Downstream loaders pulling from "the confirmed facts" will see whichever surface ran last, with no schema reconciliation. **Recommended fix scope:** spec a unified fact-key registry (single `factKeys.ts` module exporting one canonical `ALLOWED_FACT_KEYS` array, plus surface-specific subsets that import from it). Migrate both call sites to import from the registry. Add a CI guard that asserts no module defines its own `ALLOWED_FACT_KEYS` outside the registry. (Sprint subtask, ~1 day.)
- **[P1] Test-fixture name leak in `deals.name` and `deals.borrower_name` ("ChatGPT Fix 15").** P0 escalation path: if Stage 11 (sealed snapshot) or any borrower-facing surface (concierge UI, KFS narrative, listing display) reads from `name` or `borrower_name` instead of `display_name`, the test-fixture name will appear in production-shaped artifacts. **Recommended fix scope:** Stage 11 will determine the actual blast radius; if leaky columns are found, surface as P0 with surgical fix to the redactor / display layer. Otherwise, P1 cleanup to either (a) backfill `name`/`borrower_name` from `display_name` when the latter is set, or (b) deprecate the legacy columns. (Half-day after Stage 11 result.)
- **[P2] Spec v1.1 documentation drift.** Spec asserted "21 `ALLOWED_FACT_KEYS`" (wrong — 12 or 44 depending on which file), referenced `last_activity_at` (doesn't exist; column is `updated_at`). **Recommended fix scope:** correct in v1.2 of the audit spec for next cycle. (Single edit, < 30 min.)

**Critical-check status (years_in_operation reconciliation):** N/A — no concierge session exists, so the documented `confirmed_facts` vs `borrower_applicant_financials` reconciliation gap cannot be evaluated on this deal. Defer to Stage 2 to inspect financials directly.

### Stage 2 — Borrower applicant financials

**Status:** **fail**

**Findings:**

- Spec query referenced `borrower_applicant_financials.deal_id` — column does not exist. Actual schema keys financials by `applicant_id` (uuid). Live join path is `deals.id` → `borrower_applications.deal_id` → `borrower_applicants.application_id` → `borrower_applicant_financials.applicant_id`.
- Verified loader against [src/lib/score/inputs.ts:118-159](src/lib/score/inputs.ts#L118-L159) — confirms the expected join path.
- Joining the three tables for Samaritus returns **zero rows**.
- Counting all rows globally (across every deal, every tenant): `borrower_applications=0, borrower_applicants=0, borrower_applicant_financials=0`. **All three tables are completely empty.**
- This means: every deal that has been "carried through Sprint 0-5" is being scored, packaged, and (per Stage 4 onward) potentially marketplace-sealed **without any applicant financials present at all** — no FICO, no liquid assets, no net worth, no industry experience.
- Cross-referencing the loader: when `applicants.length === 0`, [src/lib/score/inputs.ts:161-167](src/lib/score/inputs.ts#L161-L167) pushes `"applicants"`, `"fico_score"`, `"liquid_assets"`, `"net_worth"`, `"industry_experience_years"` onto the `missing[]` array — but the score still computes. So the score is being computed with nulls on every borrower-strength input. Stage 4 will reveal whether nulls are being silently coerced to zeros (a P0 fallback pattern) or whether the computation correctly degrades.

**Issues filed:**

- **[P0] All three borrower applicant tables are globally empty — borrower data is not being persisted anywhere along the documented path.** Same root-cause family as Stage 1 (concierge sessions empty). Either (a) the borrower flow has been silently broken in this environment for an unknown duration, (b) the data lives in a different table (e.g., `borrower_applications` was renamed/superseded but the score loader was never updated), or (c) test deals like "ChatGPT Fix 15"/Samaritus are created via fixture scripts that populate downstream artifacts (snapshots, packages, scores) without touching the upstream applicant tables. Whichever it is, the score loader's inputs will be permanently null on the borrower-strength dimension. **Recommended fix scope:** investigation ticket joined with Stage 1's. Trace whether applicant data lives in a different table (search for `fico_score` writes across the codebase), or whether the borrower flow is silently failing. (4–8h investigation, possibly 1–3 days remediation depending on root cause.)
- **[P1] Score computes silently when all four borrower-strength inputs are null.** The loader pushes them onto `missing[]` but does not gate the score computation. Whether the score's borrower-strength component then defaults to zero, average, or "no contribution" is what Stage 4 will reveal — but the current design allows a deal with no applicant data at all to still produce a numeric score. **Recommended fix scope:** evaluate at Stage 4. If borrower-strength silently zeros (penalising the borrower for missing data we never asked for), surface as **P0**. If it correctly degrades and emits a `score_status` other than `locked`, surface as **P1** (band/tier UX work to communicate the degraded state).
- **[P2] Spec v1.1 query referenced `borrower_applicant_financials.deal_id`.** That column does not exist; the table is keyed by `applicant_id` and joined via `borrower_applications` and `borrower_applicants`. **Recommended fix scope:** correct in v1.2 of the audit spec for next cycle. (Single edit.)

### Stage 3 — SBA assumptions

**Status:** **partial**

**Findings:**

- One row exists for Samaritus (`buddy_sba_assumptions.id = 0bf4818a-7988-4fe0-8b83-e9e8b1c64122`).
- `status = 'confirmed'`, `confirmed_at = 2026-04-20 19:44:07Z` ✓.
- `loan_impact` is structurally complete: `loanAmount=$500,000`, `termMonths=120`, `interestRate=0.0725`, `revenueImpactPct=0.05`, `revenueImpactStartMonth=3`, plus a `revenueImpactDescription`. `existingDebt=[]` (empty array — note: spec referenced an `existingDebt` scalar, but the actual schema is an array of debt entries; here it's empty, which is plausible for a new acquisition or a debt-free borrower).
- Schema differs from spec v1.1: there is no `sources_and_uses` column on `buddy_sba_assumptions`. Closest analog is `cost_assumptions` (capex/hires/COGS/fixed costs) and `working_capital`. The S&U structure spec described will be checked at Stage 7 (`buddy_sba_packages`).
- `revenue_streams[0].baseAnnualRevenue = $1,360,479`, growth rates 8%/6%/5%. Stream `id = "canary_stream_1"` — **telltale fixture label**.
- `cost_assumptions.cogsPercentYear1 = 0.29`. `fixedCostCategories` total = $228,574 (Salaries) + $37,315 (Insurance) + $273,786 (Repairs & Maintenance) = **$539,675/yr**. Plus capex of $75k Y1 and one $52k hire starting month 4.
- Hand-checked DSCR coherence: EBITDA ≈ $1.36M − ($1.36M × 0.29) − $540k = **$426k**. Annual debt service on $500k @ 7.25% / 120mo: PMT ≈ $5,866/mo × 12 ≈ **$70,400/yr**. Implied Y1 base DSCR ≈ **6.05×**. That is an unusually strong DSCR — internally consistent with the inputs, but it suggests either (a) overstated revenue/margin assumptions for a real deal of this profile, or (b) undersized debt relative to operations. Not a bug per se; flag for narrative review at Stage 4 (does the score narrative call out the high DSCR, or does it gloss over it?).
- `working_capital.inventoryTurns = null` — legitimately null for a service business (yacht management has no inventory turns); this is correct, not a gap.
- `management_team[0].name = "Test Borrower"` and bio mentions **"property management and commercial real estate"** — but the deal's `display_name = "Samaritus Yacht Management"`. The management bio does not reference yachts, marine operations, or anything aligned with the actual business. **Narrative misalignment between assumptions data and deal subject.**
- `revenueImpactDescription = "Equipment upgrade increases production capacity"` — generic phrasing that does not describe a yacht management context. Same misalignment.

**Issues filed:**

- **[P1] Fixture-flavor labels leaking into authoritative assumptions.** `revenue_streams[0].id = "canary_stream_1"`, `management_team[0].name = "Test Borrower"`. If the credit memo or KFS narrative builders read raw values out of `buddy_sba_assumptions` (Stage 7 will confirm), these fixture labels will appear in lender-facing artifacts. **P0 escalation path** if Stage 7/9/11 surface them in narrative output. **Recommended fix scope:** at minimum, scrub fixture data before any seal-eligible deal can advance; longer-term, prevent test fixtures from flowing into production-shaped narrative builders. (Half-day cleanup + 1-day guard.)
- **[P1] Management-team bio does not match the business.** A yacht management company's principal is described as having 15 years in "property management and commercial real estate." Either (a) the bio was generated by a generic template that doesn't read NAICS/industry context, or (b) the bio was free-typed and the business pivoted. Either way, the bio should be rejected by validation when it does not align with the deal's industry. **Recommended fix scope:** add a narrative-coherence check to the validation gate (e.g., assert that the bio mentions terms from the deal's NAICS keywords, or reject hard-coded fixture phrases). (1–2 day subtask.)
- **[P2] Audit spec v1.1 referenced `sources_and_uses` and `working_capital_assumptions` columns on `buddy_sba_assumptions`.** Actual column names are `cost_assumptions` and `working_capital`; there is no `sources_and_uses` on this table. **Recommended fix scope:** correct in v1.2 spec; route the S&U check to Stage 7. (Single edit.)
- **[OBSERVATION — not filed]** Implied Y1 base DSCR ≈ 6.05× is unusually strong. Not a bug. Flagging for Stage 4 review of whether the score narrative addresses this, and for Stage 7 cross-check against `buddy_sba_packages.dscr_year1_base`.

### Cross-stage scope sweep (single query, used to inform stages 4-12)

| Table | Rows total | Samaritus rows |
|---|---:|---:|
| `deals` | 11 | 1 |
| `borrower_applications` | 0 | 0 |
| `borrower_concierge_sessions` | 0 | 0 |
| `buddy_sba_assumptions` | 1 | 1 |
| `buddy_feasibility_studies` | **1** | **0** |
| `buddy_sba_packages` | 1 | 1 |
| `buddy_sba_scores` | **0** | **0** |
| `buddy_trident_bundles` | **0** | **0** |
| `buddy_validation_reports` | **0** | **0** |
| `buddy_sealed_packages` | **0** | **0** |
| `deal_financial_facts` | 1,824 | 169 |
| `marketplace_rate_card` | 44 | n/a |

**What this tells us about the audit's premise.** The spec opens with: "Samaritus has been carried through Sprints 0-5 and has the most complete fixture data of any deal in the system." The data does not bear that out. Samaritus has data in four tables (`deals`, `sba_assumptions`, `sba_packages`, `deal_financial_facts`) and is absent from seven (`borrower_applications`, `concierge_sessions`, `sba_scores`, `feasibility_studies`, `trident_bundles`, `validation_reports`, `sealed_packages`). Three of those seven (`sba_scores`, `trident_bundles`, `sealed_packages`) are **globally empty** — no deal in the system has progressed through scoring or Sprint 5's sealing pipeline.

**Implication for stages 4, 6, 9, 10, 11.** Each will be a "no row exists" finding for Samaritus. The audit will still report status and recommended fixes, but the punchlist will lean heavily toward "the upstream producer of this artifact is not running, or this DB instance has never seen production-shaped traffic."

### Stage 4 — Buddy SBA Score

**Status:** **fail**

**Findings:**

- Zero score rows exist for Samaritus. Verified.
- Zero score rows exist **globally** (`SELECT COUNT(*) FROM buddy_sba_scores → 0`). The score table has never been written to in this DB instance — across all 11 deals.
- This contradicts Stage 3's confirmed assumptions and Stage 7's expected `buddy_sba_packages` row (verified to exist for Samaritus). Either (a) the score-computation worker has never run successfully against any deal in this environment, (b) scores are written to a different table/schema, or (c) score writes are rolling back / failing silently.
- Cross-referencing the loader at [src/lib/score/inputs.ts](src/lib/score/inputs.ts): the loader reads `borrower_applications` (empty), `borrower_applicants` (empty), `borrower_applicant_financials` (empty), `buddy_sba_packages` (Samaritus has a row), and other inputs. With no applicants, the score's borrower-strength dimension would be entirely null. Whether the worker would emit a `score_status='locked'` row, an `error` row, or no row at all under those conditions is what we cannot observe — because **no row is ever produced**.
- The sealing gate at [src/lib/brokerage/sealingGate.ts](src/lib/brokerage/sealingGate.ts) requires a `locked` score with rate-card-eligible band. With zero rows, the gate cannot pass for any deal in this environment.

**Issues filed:**

- **[P0] `buddy_sba_scores` is globally empty — score worker has never produced output in this DB instance.** This is the most severe finding of the audit so far. The score is the lifecycle gate for marketplace listing. A globally empty table means: no deal can ever satisfy the sealing gate, which means the entire downstream marketplace pipeline (Sprint 5's sealing → matching → KFS publication) is gated behind a zero-output upstream. **Recommended fix scope:** trace the score-producing path. Likely entry points: ReadinessPanel "Recompute score" action, snapshot recompute job, lifecycle stage transitions. Determine whether the worker errors silently, whether writes are blocked by RLS, or whether the worker simply has not been triggered for any deal. Investigation ticket of its own (1–3 days, possibly more depending on root cause). Until this is resolved, every other audit stage produces "no row" findings downstream.
- **[P0] No path exists to ever satisfy `canSeal()`.** Direct consequence of the above. Until a score row is produced, `canSeal()` returns false on every deal — including Samaritus, which otherwise has confirmed assumptions and a package. **Recommended fix scope:** part of the same investigation ticket as the score worker.
- **[OBSERVATION]** Spec's "Critical check" of `years_in_operation` reconciliation between `confirmed_facts` / `borrower_applicant_financials` / score is **N/A** for this audit — none of the three sources have data for Samaritus. Will need to be evaluated on a deal that has actually flowed through borrower intake, once one exists.

### Stage 5 — Eligibility engine

**Status:** **partial** (code-review only — no score row to observe outputs against)

**Findings:**

- The eligibility engine lives at [src/lib/score/eligibility/evaluate.ts](src/lib/score/eligibility/evaluate.ts) (function: `evaluateBuddySbaEligibility`). It is a **pure function** — no DB, no I/O — and it implements 9 SOP 50 10 7.1 categories:

| # | Category | Implementation status | Reads from |
|---|---|---|---|
| 1 | `for_profit` | **real** | `borrower_applications.business_entity_type` |
| 2 | `size_standard` | **real, default-deny on unknown NAICS** | `borrower_applications.naics` + revenue/employee count |
| 3 | `use_of_proceeds_prohibited` | **real** (regex on use-of-proceeds + sources_and_uses text) | `buddy_sba_packages.use_of_proceeds`, `sources_and_uses` |
| 4 | `franchise_sba_eligible` | **real** (only fires if `isFranchise`) | franchise inputs from caller |
| 5 | `hard_blockers` | **real** | `buddy_sba_risk_profiles.hard_blockers` |
| 6 | `passive_business` | **scaffolded — always pass** | n/a |
| 7 | `real_estate_speculation` | **partially scaffolded** (naive 531* NAICS + speculative regex) | NAICS + UoP text |
| 8 | `pyramid_mlm` | **scaffolded — always pass** | n/a |
| 9 | `lending_investment` | **real** (NAICS prefix 522/523/525) | NAICS |

- **Mental walkthrough for Samaritus:**
  - `for_profit`: Samaritus has no `borrower_applications` row → `business_entity_type` is null/empty → falls into the `!entityTypeUpper` branch at [evaluate.ts:131-136](src/lib/score/eligibility/evaluate.ts#L131-L136) → emits `for_profit_unknown` failure. **Would fail.**
  - `size_standard`: NAICS would also be null → [sbaSizeStandards.ts:157-165](src/lib/score/eligibility/sbaSizeStandards.ts#L157-L165) returns `{ passed: false, unknownNaics: true }`. **Would fail.** Even if a NAICS were present, yacht-management NAICS (488390 / 487210 / 532411) are **not** in the top-50 table at [sbaSizeStandards.ts:42-112](src/lib/score/eligibility/sbaSizeStandards.ts#L42-L112) — would also default-deny. So this category will fail on every yacht/marine deal until the size-standards table is expanded.
  - `use_of_proceeds_prohibited`: Samaritus has a `buddy_sba_packages` row (Stage 7); will need to inspect the actual UoP text to determine pass/fail at Stage 7.
  - `franchise_sba_eligible`: skipped (Samaritus is non-franchise — passes vacuously).
  - `hard_blockers`: depends on `buddy_sba_risk_profiles` — not yet checked, but likely empty given the broader empty-table pattern.
  - Categories 6, 7, 8 are scaffolded — they would pass for any deal regardless of inputs.
  - `lending_investment`: Samaritus is not in 522/523/525 NAICS prefix → would pass.
- **Outcome:** if the score worker were running, Samaritus would fail eligibility on at minimum `for_profit_unknown` and `size_standard` (no entity type, no NAICS in top-50). This is the correct behavior for the inputs available — the engine is doing its job. The problem is upstream: the inputs are not being captured.

**Issues filed:**

- **[P1] Three of nine SOP categories are scaffolded — `passive_business`, `pyramid_mlm`, full `real_estate_speculation`.** The file admits this honestly ("scaffolded — richer detection deferred"). Until they're real, an SBA-prohibited business in those categories could pass eligibility. **Recommended fix scope:** Sprint of its own — each scaffolded check needs domain logic + golden-corpus tests. Lowest risk to defer behind a "manual review" UX flag rather than ship as silent pass. (Sprint of ~5 days.)
- **[P1] Size-standards table is top-50 NAICS only.** Source file at [sbaSizeStandards.ts:1-21](src/lib/score/eligibility/sbaSizeStandards.ts#L1-L21) marks itself a **PLACEHOLDER**. Default-deny is correct, but it means any deal whose NAICS is outside food service / professional services / construction / common retail / common healthcare / personal services / etc. will fail size-standard. Marine/yacht/agriculture/heavy-industry deals will all default-deny. **Recommended fix scope:** transcribe full 13 CFR §121.201 table (1,000+ NAICS). Already filed as a follow-up ticket in the source comment, just needs prioritization. (~2 days for transcription + review.)
- **[OBSERVATION]** The naming-collision note at the top of [evaluate.ts:6-10](src/lib/score/eligibility/evaluate.ts#L6-L10) — `evaluateBuddySbaEligibility` was named to avoid a collision with the existing `evaluateSbaEligibility` (11 consumers, different signature) — is a parallel-implementation smell. Two SBA-eligibility engines coexist. Worth a separate ticket to determine which one is authoritative for the Buddy score path, and whether the older one should be deprecated. **Recommended fix scope:** consolidation investigation (1 day) + migration ticket. **Filed as P1.**

### Stage 6 — Feasibility study

**Status:** **fail**

**Findings:**

- Zero feasibility studies exist for Samaritus.
- One feasibility study exists globally — for some other deal. Not Samaritus.
- Schema differs from spec v1.1: there is no `generated_at` or `generation_status` column on `buddy_feasibility_studies`. Actual columns include `created_at`, `updated_at`, `status`, `version_number`, plus dimension scores and JSONB detail blobs (`market_demand_detail`, `financial_viability_detail`, `operational_readiness_detail`, `location_suitability_detail`, `narratives`, `franchise_comparison`, `flags`, `data_completeness`, `pdf_url`, `projections_package_id`, `recommendation`, `confidence_level`).
- Cross-stage finding: feasibility is a documented input to the score (per Sprint 0 spec) and to credit memo narrative. With no feasibility study, no composite score, no narratives — the credit memo's feasibility section will be empty for Samaritus.

**Issues filed:**

- **[P0] No feasibility study has been generated for Samaritus.** Same root-cause family as Stage 4 — the producer (a feasibility-generation worker, prompted at the right lifecycle gate) has not run for this deal. Single feasibility row globally suggests the worker has run for at least one deal in this DB, but not Samaritus. **Recommended fix scope:** trace the feasibility-trigger path. Likely entry points: cockpit "Generate feasibility" action, lifecycle stage transition into `feasibility_ready`. Investigation joined with the broader "upstream producers not running" investigation. (Subtask of the Stage 4 investigation, ~half-day add-on.)
- **[P2] Spec v1.1 referenced columns `generated_at` and `generation_status` on `buddy_feasibility_studies`.** Actual columns are `created_at`, `updated_at`, `status`, `version_number`. **Recommended fix scope:** correct in v1.2 spec.
- **[OBSERVATION]** Composite-score formula and dimension weights are not visible from the schema alone. Cross-reference will be needed at the recommended-fix-sequence step against the Sprint 0 / `FEASIBILITY_STUDY_GOD_TIER_SPEC.md` documents.

### Stage 7 — SBA package + financial spread

**Status:** **partial** (data exists, multiple correctness issues found)

**Findings:**

- One package row exists for Samaritus (`buddy_sba_packages.id = aa8efdd8-5299-4328-8937-157d0bfdff37`), `version_number = 1`, `status = 'draft'`, `generated_at = 2026-04-20 19:44:15Z` (8s after assumptions confirmed — appears to be auto-generated immediately on assumption confirmation).
- **DSCR math: internally consistent.** From `projections_annual[0]`: `ebitda = 494,928.36`, `totalDebtService = 70,440.62`, `dscr = 7.0262`. Hand-check: 494,928 / 70,441 = **7.0262** ✓. Y2 base = 7.7077, Y3 base = 8.5805 — monotonic with revenue growth. Y1 downside = 4.5093 < Y1 base = 7.0262 ✓ stress-scenario sanity check holds.
- **`dscr_below_threshold = false`** — correct given DSCR ≈ 7× sits well above any reasonable threshold (1.20–1.25).
- **SBA guarantee math: correct.** Loan = $500k, guarantee_pct = 0.75 → guarantee_amount = $375,000 ✓; bank_exposure = $125,000 / 0.25 = 25% ✓.
- **`global_dscr = null`** — plausible (Samaritus has no other businesses to aggregate); not flagged.
- **`base_year_data`** is structurally complete: `revenue=1,360,479` (matches assumptions), `cogs=449,671` (33% of revenue — note assumptions said 29%, off by ~$54k), `ebitda=351,018`, `ebit=320,368`, `netIncome=204,096`, `depreciation=30,650`. `dscr=99` (sentinel for "no debt"; `totalDebtService=0` in base year).
- **`use_of_proceeds = []` and `sources_and_uses = {}`** — both **empty**. The loan is presumably for "Equipment upgrade" per assumptions' `revenueImpactDescription`, but no use-of-proceeds detail has flowed into the package, and there's no sources-and-uses table at all.
- **Revenue growth math mismatch.** Assumptions say `revenue_streams[0].growthRateYear1 = 0.08` and `loan_impact.revenueImpactPct = 0.05`. Package projections `year1.revenueGrowthPct = 0.125`. None of the obvious combinations match: `0.08 + 0.05 = 0.13`, `(1.08)(1.05) - 1 = 0.134`. The package's 12.5% does not match either additive or compound combination of assumption inputs. **Math discrepancy between authoritative sources.**
- **COGS percentage drift.** Assumptions say Y1 `cogsPercentYear1 = 0.29`. Base year package data shows COGS = 449,671 / 1,360,479 = **33.05%**. Y1 projection shows COGS = 443,856 / 1,530,539 = **29.0%** ✓. So Y1 projection respects the assumption, but the **base year is computed differently** (presumably from the financial facts, not the assumption). Worth verifying at Stage 8 whether base-year COGS comes from MMAS facts.
- **Margin-of-safety math discrepancy.** `break_even_revenue = 833,457`. Stated `margin_of_safety_pct = 0.4554`. Hand-check formulas: (revenue − BE) / revenue = (1,360,479 − 833,457) / 1,360,479 = **0.387**. (revenue − BE) / BE = 0.632. Neither matches 0.4554. Either the field uses a third formula (e.g., projected revenue rather than base, or a stress-scenario revenue) or the math is inconsistent.
  - Verify: against projection Y1 revenue $1,530,539: (1,530,539 − 833,457) / 1,530,539 = **0.4554** ✓. Mystery solved — `margin_of_safety_pct` is computed against **Year-1 projection revenue**, not base-year revenue. Internally consistent but unintuitive label. Worth a docstring or rename.
- **Narrative completeness:** `business_overview_narrative` populated (1,916 chars). `executive_summary`, `industry_analysis`, `plan_thesis`, `marketing_strategy`, `operations_plan`, `swot_*`, `franchise_section`, `sensitivity_narrative`, `reviewer_notes` — **all NULL**. Only one of ~12 narrative columns is populated.
- **`pdf_url` is set** — a PDF was generated even though half the narrative columns are null. Will need Stage 9 (Trident bundle) to confirm whether the PDF includes the empty sections gracefully or shows "[null]" / blank pages.
- **`status = 'draft'`** — package has never been promoted to `reviewed` or `submitted`, despite the deal sitting at `stage = 'underwriting'`. Lifecycle and package state are out of sync.
- **`package_warnings = []` and `benchmark_warnings = []`** — the package generator did not flag the empty UoP, the empty S&U, the missing narrative columns, or the math drift. Either the warning generator never ran, or its checks don't cover these conditions. Both are problems.

**Issues filed:**

- **[P0] Eligibility engine silently passes use-of-proceeds when both inputs are empty.** Cross-cutting bug found by tracing Stage 5 + Stage 7 data together. Logic at [src/lib/score/eligibility/evaluate.ts:106-121 (`collectUopText`)](src/lib/score/eligibility/evaluate.ts#L106-L121): when `useOfProceeds = []` (the for-loop adds nothing) and `sourcesAndUses = {}` (the typeof check passes, so `JSON.stringify({})` = `"{}"` is appended), the resulting `uopText` = `"{}"` — truthy. The check at [evaluate.ts:171-178](src/lib/score/eligibility/evaluate.ts#L171-L178) only emits `use_of_proceeds_unknown` when `uopText` is **falsy**. Result: a deal with no use-of-proceeds and no sources-and-uses **passes** the eligibility check, because `"{}"` doesn't match any prohibited regex. **This is fail-safe-NO** — the engine should fail-safe-YES (default-deny on missing data). **Recommended fix scope:** in `collectUopText`, only push `JSON.stringify(sourcesAndUses)` if the object has at least one own property. Add a regression test where both inputs are empty/empty and assert `use_of_proceeds_unknown` failure. (Single commit, ~1h fix + 30min test.)
- **[P0] Samaritus package has empty `use_of_proceeds` and empty `sources_and_uses`.** The package was generated 8s after assumptions confirmation, but the upstream UoP/S&U capture path never wrote anything. Per the eligibility-engine bug above, this would silently pass the score's UoP check. Per Sprint 5's KFS contract, `forRedactor.deal.use_of_proceeds` and `forRedactor.deal.sources_and_uses` are likely required fields — Stage 11 will confirm whether the redactor copes with empties. **Recommended fix scope:** trace the package generator at the time-window 2026-04-20 19:44:07 → 19:44:15. Find where UoP/S&U should have been read from (likely from `assumptions.cost_assumptions.plannedCapex` + `loan_impact.loanAmount` to construct a synthesized S&U). Either populate from existing assumption data, or fail the package generation when UoP/S&U cannot be derived. (1–2 day subtask.)
- **[P1] Revenue growth in projections (12.5%) does not match any obvious combination of assumption inputs (`growthRateYear1 = 0.08`, `revenueImpactPct = 0.05`).** Either the projector applies a third growth source we're not seeing, or the math is bypassed in favor of a default. **Recommended fix scope:** trace the projection generator (likely `src/lib/financialEngine/` or similar). Either fix the math to match `(1 + base_growth)(1 + loan_impact) - 1` formula (correct compound), or document the actual formula in the package's metadata. Add a CI guard that asserts `projections.revenueGrowthPct` is reproducible from assumptions. (Half-day investigation + half-day fix + test.)
- **[P1] Eight of ~12 narrative columns are NULL on the package** (`executive_summary`, `industry_analysis`, `plan_thesis`, `marketing_strategy`, `operations_plan`, `swot_strengths/weaknesses/opportunities/threats`, `franchise_section`, `sensitivity_narrative`). The package PDF presumably renders sections from these; null columns will produce empty sections. **Recommended fix scope:** narrative builders need to be wired into the package-generation pipeline. Likely already implemented as separate steps that didn't fire. (1-day wire-up + smoke test.)
- **[P1] Base-year COGS percentage (33.05%) does not match assumption (29%).** Suggests base-year is read from MMAS facts (Stage 8) while projections honor the assumption — fine, but the discrepancy should be either reconciled or surfaced in the package's narrative. Currently silent. **Recommended fix scope:** add a base-year-vs-assumption variance line item to `package_warnings` when COGS%, gross margin %, or fixed-cost-per-revenue diverge by > X% between actual base year and assumed Y1+. (1–2 day subtask.)
- **[P1] `package_warnings = []` and `benchmark_warnings = []` despite multiple data anomalies.** The warning generator either never ran, or its checks don't cover empty UoP, empty S&U, null narrative columns, COGS variance, or growth math drift. **Recommended fix scope:** define a complete warning contract (likely 8–12 checks) and ensure the warning generator runs as part of every `buddy_sba_packages` insert/update. (1–2 day subtask, possibly merged with the COGS-variance fix above.)
- **[P2] `margin_of_safety_pct` field is computed against **Year-1 projected revenue**, not base-year revenue.** Mathematically defensible but unintuitive given the field name. Verified: (1,530,539 − 833,457) / 1,530,539 = 0.4554 ✓. **Recommended fix scope:** rename to `margin_of_safety_year1_pct` or add a column docstring/migration. Cosmetic. (Single commit.)
- **[P2] `status = 'draft'`** despite deal at `stage='underwriting'`. Likely a result of the broader workflow not promoting packages, but worth surfacing for the lifecycle audit. **Recommended fix scope:** review whether the lifecycle should auto-promote packages from `draft` to `reviewed` at certain stages, or whether reviewer action is always required. Probably a Sprint 4-era discussion to revisit. (Defer to follow-on.)

### Stage 8 — Financial facts (MMAS) + provenance

**Status:** **partial** (rich data, but P0 fallback pattern + MMAS coverage gaps + waterfall reconciliation issues)

**Coverage summary — 169 facts for Samaritus across 7 fact_types:**

| `fact_type` | Rows | Distinct keys |
|---|---:|---:|
| TAX_RETURN | 86 | 35 |
| PERSONAL_FINANCIAL_STATEMENT | 24 | 24 |
| PERSONAL_INCOME | 22 | 16 |
| INCOME_STATEMENT | 13 | 13 |
| SOURCE_DOCUMENT | 9 | 5 |
| EXTRACTION_HEARTBEAT | 9 | 9 |
| BALANCE_SHEET | 6 | 6 |

**Income statement (period 2025) — 13 facts.** Specific values verified:

| Fact | Value | Hand-check |
|---|---:|---|
| TOTAL_REVENUE | 1,360,479 | matches assumptions ✓ |
| COST_OF_GOODS_SOLD | 392,171 | 28.83% of revenue — matches assumption `cogsPercentYear1=0.29` ✓ |
| GROSS_PROFIT | 968,308 | 1,360,479 − 392,171 = 968,308 ✓ |
| SALARIES_WAGES_IS | 228,574 | matches assumption fixed-cost line ✓ |
| INSURANCE_EXPENSE_IS | 37,315 | matches assumption fixed-cost line ✓ |
| REPAIRS_MAINTENANCE_IS | 273,786 | matches assumption fixed-cost line ✓ |
| ADVERTISING_IS | 23,604 | (no source to compare) |
| OTHER_OPERATING_EXPENSES_IS | 30,719 | (no source to compare) |
| INTEREST_EXPENSE | 80,520 | (no source to compare) |
| DEPRECIATION | 83,883 | does NOT match base_year_data depreciation = 30,650 |
| TOTAL_OPERATING_EXPENSES | 423,818 | **does NOT reconcile** with sum of line items |
| OPERATING_INCOME | 204,121 | **does NOT match waterfall** |
| NET_INCOME | 204,096 | ≈ OI but waterfall doesn't reconcile to revenue − expenses |

**Income statement reconciliation issue:** sum of operating-expense line items (Advertising + Insurance + R&M + Salaries + Other = $594,998) does **not** equal `TOTAL_OPERATING_EXPENSES = 423,818`. Discrepancy = $171,180. Likely cause: salaries are treated separately from "operating expenses" in the source document, but the keys persisted suggest a different aggregation rule. **Authoritative facts about the same income statement do not internally reconcile.**

**Operating-income waterfall:** `revenue − COGS − OpEx = 1,360,479 − 392,171 − 423,818 = 544,490` — but persisted `OPERATING_INCOME = 204,121`. Off by $340k. Either OpEx in the persisted total includes additional items not visible as separate facts (e.g., depreciation, interest) or the extracted Operating Income field came from a different income-statement section (e.g., after non-operating items).

**Balance sheet — 6 distinct keys, multi-period (some keys with 4 periods):**
- ✓ SL_CASH (4 periods), SL_PPE_GROSS (4), SL_TOTAL_ASSETS (4), SL_ACCUMULATED_DEPRECIATION (4), SL_RETAINED_EARNINGS (3), SL_ACCOUNTS_PAYABLE (3), SL_MORTGAGES_NOTES_BONDS (2), SL_TOTAL_LIABILITIES (1), SL_TOTAL_EQUITY (1)
- **Missing:** SL_AR / SL_ACCOUNTS_RECEIVABLE, SL_INVENTORY, SL_TOTAL_CURRENT_ASSETS, SL_TOTAL_CURRENT_LIABILITIES, SL_LTD (long-term debt as distinct from mortgages/notes/bonds)
- Consequence: **current ratio cannot be computed**, **quick ratio cannot be computed** — both depend on current-asset and current-liability totals.

**MMAS coverage gaps vs. spec's expected list:**

| Spec key | Found? | Notes |
|---|---|---|
| REVENUE | partial | Persisted as `TOTAL_REVENUE`, not `REVENUE` — name drift |
| COGS | partial | Persisted as `COST_OF_GOODS_SOLD`, not `COGS` |
| GROSS_PROFIT | ✓ | |
| SALARIES_WAGES_IS | ✓ | |
| RENT_IS | **missing** | Not extracted — but assumptions don't have a Rent line either; possibly N/A for yacht mgmt |
| DEPRECIATION_IS | **missing** | `DEPRECIATION` exists without `_IS` suffix |
| INTEREST_EXPENSE_IS | **missing** | `INTEREST_EXPENSE` exists without `_IS` suffix |
| EBITDA | **missing** | Not persisted as a fact (lives in `buddy_sba_packages.base_year_data` only) |
| EBIT | **missing** | Same |
| NET_INCOME | ✓ | |
| SL_CASH | ✓ | |
| SL_AR | **missing** | |
| SL_INVENTORY | **missing** | (legitimate N/A for service business — but should still emit a 0-with-source-note rather than absence) |
| SL_TOTAL_CURRENT_ASSETS | **missing** | |
| SL_PPE | partial | Persisted as `SL_PPE_GROSS` |
| SL_TOTAL_ASSETS | ✓ | |
| SL_AP | partial | Persisted as `SL_ACCOUNTS_PAYABLE` |
| SL_TOTAL_CURRENT_LIABILITIES | **missing** | |
| SL_LTD | partial | Persisted as `SL_MORTGAGES_NOTES_BONDS` |
| SL_TOTAL_LIABILITIES | ✓ | |
| SL_EQUITY | partial | Persisted as `SL_TOTAL_EQUITY` |
| DSCR / CURRENT_RATIO / QUICK_RATIO / DEBT_TO_EQUITY / GROSS_MARGIN / OPERATING_MARGIN | **missing** (all) | Per architecture, ratios likely computed at render-time, not persisted as facts. Worth confirming with engineering before flagging. |

**`_IS` suffix consistency:** the suffix is **inconsistent**.
- With `_IS`: ADVERTISING_IS, INSURANCE_EXPENSE_IS, OTHER_OPERATING_EXPENSES_IS, REPAIRS_MAINTENANCE_IS, SALARIES_WAGES_IS (5)
- Without `_IS`: COST_OF_GOODS_SOLD, DEPRECIATION, GROSS_PROFIT, INTEREST_EXPENSE, NET_INCOME, OPERATING_INCOME, TOTAL_OPERATING_EXPENSES, TOTAL_REVENUE (8)

The convention appears to be: dimension-level expense lines get `_IS`; aggregates and "named" P&L items don't. But this is not stated explicitly in `keys.ts` and downstream consumers assuming a uniform suffix would break.

### Provenance summary (Stage 8 specific)

| Provenance flag | Count | Sample fact_keys |
|---|---:|---|
| **OK** | 150 | TOTAL_REVENUE, GROSS_PROFIT, SALARIES_WAGES_IS, SL_CASH, SL_TOTAL_ASSETS, etc. |
| **P0_LOW_CONFIDENCE_ZERO** | **4** | (see below — these are the audit's most actionable findings) |
| **P2_VERIFY_LEGITIMATE_ZERO** | 12 | DEPRECIATION (1 of 4), K1_ORDINARY_INCOME_2 (1 of 3), K1_ORDINARY_INCOME_3 (1 of 3), PFS_CONTINGENT_LIABILITIES, PFS_IRA_401K, PFS_LIFE_INS_CSV, PFS_LIFE_INS_LOAN, PFS_UNPAID_TAXES, QBI_DEDUCTION (3), TAXABLE_INCOME (1), TOTAL_TAX (2) |
| **P2_VERIFY_LEGITIMATE_ZERO_NUMERIC** | 3 | Zeros whose extracted snippet is `"0."` — looks like a real "0." on the form rather than a fallback |
| P1_MISSING_PROVENANCE | 0 | None — every Samaritus fact has provenance JSONB populated |
| P1_MISSING_EXTRACTOR_TAG | 0 | None |

**The 4 P0 fallback findings (extracted snippet is form INSTRUCTION TEXT, not a value):**

| Fact key | Period | Persisted value | Snippet (the alleged "value") | Extractor | Confidence |
|---|---|---:|---|---|---:|
| ADJUSTED_GROSS_INCOME | 2025 | 0 | `"line 11. If zero or less, enter -0"` | `personalIncomeExtractor:v2:deterministic` (path=`ocr_regex`) | 0.55 |
| SCH_E_DEPRECIATION | 2023 | 0 | `"line 18. If zero or less, enter -0"` | same | 0.55 |
| SCH_E_DEPRECIATION | 2025 | 0 | `"line 18. If zero or less, enter -0"` | same | 0.55 |
| TOTAL_TAX | 2025 | 0 | `"line 24, subtract line 24"` | same | 0.55 |

In all four cases the regex extractor matched on the **form's printed instructions** rather than on a numeric value, then defaulted the persisted value to 0. **The persisted "0" is meaningless — it does not represent a real extraction.** Yet downstream consumers that read `fact_value_num` will see "0" and treat it as authoritative.

**This is exactly the "fallback masking a real gap" pattern the spec was designed to surface.** Provenance is populated, but the *content* of the provenance reveals the extraction failed. The naive `fact_value_num=0 + provenance IS NULL` check would have missed all four — they have provenance but the snippet exposes the failure.

**Issues filed:**

- **[P0] Four `personalIncomeExtractor:v2:deterministic` ocr_regex extractions wrote `0` when the regex matched form instruction text, not a number.** Concretely: ADJUSTED_GROSS_INCOME 2025, SCH_E_DEPRECIATION 2023, SCH_E_DEPRECIATION 2025, TOTAL_TAX 2025. **Recommended fix:** add a post-extraction sanity check in [src/lib/financialSpreads/extractors/personalIncome.ts](src/lib/financialSpreads/extractors/personalIncome.ts) (or wherever the v2:deterministic regex lives) that rejects any "extracted value" whose source snippet contains alphabetic characters (i.e., letters) — because a numeric tax field's snippet should be digits + decimal + comma, never English words. On rejection: do NOT persist 0; either persist the fact with `fact_value_num=NULL` and `resolution_status='extraction_failed'`, or skip the row entirely and emit a `match.no_extract` ledger event so the failure is visible. (1 day fix + golden-corpus regression test.)
- **[P0] Income-statement waterfall does not reconcile.** Sum of opex line items ($594,998) ≠ `TOTAL_OPERATING_EXPENSES` ($423,818). And `revenue − COGS − OpEx = $544,490` ≠ persisted `OPERATING_INCOME = $204,121`. Either the extractor pulled values from inconsistent sections of the statement, or the IS keys persisted are not aggregations of the same population. **Either way, downstream consumers reading these facts will produce internally-inconsistent narratives.** **Recommended fix scope:** add a validator that runs after IS extraction completes and asserts `Σ(opex line items) == TOTAL_OPERATING_EXPENSES ± tolerance`, and `revenue − COGS − OpEx == OPERATING_INCOME ± tolerance`. On violation: persist a `validation_failure` event and require operator review before promoting facts to canonical. (2 days — validator + golden corpus + UI surface.)
- **[P0] Balance sheet missing AR, Inventory, Total Current Assets, Total Current Liabilities.** Without these, current ratio and quick ratio cannot be computed. Per memory's "Buddy must be the world's expert on every line item of the Moody's MMAS spread", missing 4 of the most fundamental BS line items is a quality blocker. **Recommended fix scope:** check whether the BS extractor is configured to extract these and they're failing silently, or whether they're not in the extractor's prompt at all. Add to extractor + add as required fields. (2 days.)
- **[P1] `_IS` suffix is inconsistently applied.** 5 IS-line keys have `_IS`; 8 do not. **Recommended fix scope:** one-time migration to standardize. Either suffix all IS-derived keys (preferred per spec memory) or remove the suffix entirely (less work but breaks past code). Add a CI guard that asserts the convention. (1 day, including data backfill.)
- **[P1] Name drift between expected MMAS keys and persisted keys.** `REVENUE` vs `TOTAL_REVENUE`, `COGS` vs `COST_OF_GOODS_SOLD`, `SL_PPE` vs `SL_PPE_GROSS`, `SL_AP` vs `SL_ACCOUNTS_PAYABLE`, `SL_LTD` vs `SL_MORTGAGES_NOTES_BONDS`, `SL_EQUITY` vs `SL_TOTAL_EQUITY`. **Recommended fix scope:** publish a canonical mapping (or rename to canonical names). Downstream consumers must not need to know two synonyms for each line item. (2 days, including downstream consumer migration.)
- **[P1] EBITDA / EBIT not persisted as facts.** They live only in `buddy_sba_packages.base_year_data`. If a future consumer wants EBITDA, they must reach into the package's JSONB blob rather than reading a clean fact. **Recommended fix scope:** compute and persist EBITDA + EBIT as derived facts after IS materialization completes. (Half-day + test.)
- **[P1] DEPRECIATION fact value (83,883) does not match `buddy_sba_packages.base_year_data.depreciation` (30,650).** Two authoritative-looking sources disagree on a single Y0 value. **Recommended fix scope:** trace which source is correct (likely the fact, since it has provenance). Update the package generator to prefer facts over hard-coded values in base_year_data. (Half-day.)
- **[P2] 12 P2 zeros and 3 P2_NUMERIC zeros appear plausibly legitimate.** PFS contingent liabilities, PFS unpaid taxes, PFS retirement accounts at 0 are plausible for a 100%-owner of a yacht-management LLC who keeps assets in the business. QBI = 0 across 3 years is plausible if the K1s pass through losses or if QBI was zeroed by phaseout. **Recommended fix scope:** spot-check 2-3 of these manually against the source documents. If all legitimate, document positively in the deliverable. (No code change — verification only.)
- **[P2] Two extractors (`gemini_primary_v1` and `personalIncomeExtractor:v2:deterministic`) write the same fact_key for the same period, both with their own provenance.** The `is_superseded` and `fact_version` columns exist but were not queried; whether the deterministic v2 row supersedes the primary v1 row, or whether both are intentionally retained for cross-check, is not visible from this query. **Recommended fix scope:** confirm intent. If both should coexist, document explicitly; if v2 should supersede v1, audit `is_superseded` flag-setting logic. (Half-day.)
- **[OBSERVATION]** No facts have `provenance IS NULL` or `source_document_id IS NULL` for Samaritus. Provenance hygiene is **good** for Samaritus's existing facts. The audit's risk is not "are facts traceable" (yes, they are) but "are extractions correct" — and the 4 P0 fallback findings demonstrate that even with full provenance, content quality is not guaranteed.

### Stage 9 — Trident bundle

**Status:** **fail**

**Findings:**

- Zero trident bundle rows for Samaritus.
- Zero trident bundle rows globally.
- Schema differs from spec: actual columns are `business_plan_pdf_path`, `projections_pdf_path`, `projections_xlsx_path` (extra column not in spec), `feasibility_pdf_path`; `redactor_version` (not `redaction_version`); plus `generation_started_at`, `generation_completed_at`, `generation_error` for fault tracking.
- Source code at [src/lib/brokerage/trident/generateTridentBundle.ts](src/lib/brokerage/trident/generateTridentBundle.ts) and [src/lib/brokerage/trident/redactor.ts](src/lib/brokerage/trident/redactor.ts) exists — the producers are written but have not run.
- **Manual eyeball** (per spec — download preview bundle PDFs and inspect): N/A — no bundle exists to inspect. All 8 sub-checks (watermark, no precise dollar amounts, narrative placeholders, DSCR visible, page count) cannot be evaluated.

**Issues filed:**

- **[P0] No trident bundle has been generated for Samaritus, and the global table is empty.** Same root-cause family as Stages 4/6 — Sprint 5's bundle producer has not run for any deal in this DB. Verifiable via the empty `buddy_trident_bundles` table. **Recommended fix scope:** subtask of the broader "upstream producers not running" investigation. (Half-day add-on; will likely surface a single trigger-condition fix that unlocks bundle generation for all deals.)
- **[P1] `projections_xlsx_path` column exists in the schema but is not in the spec v1.1.** Suggests a fourth redaction artifact (XLSX projections) was added without spec update. **Recommended fix scope:** confirm whether XLSX is part of the formal Trident bundle contract. If yes, add to the marketplace KFS spec and redactor coverage tests. (Half-day verification.)
- **[OBSERVATION]** Once a bundle is generated for Samaritus, the spec's 8 manual-eyeball checks are still the right verification — re-run after the producer is fixed.

### Stage 10 — Sealing readiness

**Status:** **fail**

**Findings:**

The sealing gate would fail Samaritus on every check. Single SQL evaluation:

| Gate input | Required | Actual for Samaritus | Pass? |
|---|---|---|---|
| Locked score | non-null with rate-card-eligible band | NULL — no `buddy_sba_scores` row exists | **fail** |
| Eligibility passed | true | NULL — no score record | **fail** |
| Assumptions confirmed | `status='confirmed'` | `'confirmed'` ✓ | pass |
| Preview Trident bundle | `mode='preview' AND status='succeeded' AND superseded_at IS NULL` | NULL — no bundle exists | **fail** |
| Validation report passed | latest `overall_status='passed'` | NULL — table is empty globally | **fail** |
| Not already sealed | no active `buddy_sealed_packages` row | no row ✓ | pass |

- 4 of 6 gates fail. The two passes (`assumptions confirmed`, `not already sealed`) are not sufficient.
- This is the **expected outcome** given Stages 4, 6, 9: with no score, no trident bundle, no validation report, the gate cannot pass.
- The gate logic itself is **correct in spirit** — fail-safe-NO when prerequisites are missing.

**Issues filed:**

- **[OBSERVATION]** No new findings beyond what Stages 4/6/9 already filed. The gate is doing its job — failing because upstream producers haven't produced.
- **[P2] Spec v1.1's gate-evaluation SQL referenced columns that may not exist on `buddy_validation_reports`** (the table is empty so we can't introspect via INSERT). **Recommended fix scope:** at next audit, query `information_schema.columns` for `buddy_validation_reports` once it has rows. (No action now.)

### Stage 11 — Sealing dry-run (read-only)

**Status:** **partial** (will execute once buildSealedSnapshot can be invoked)

**Findings:**

- Script written at `/tmp/audit-snapshot.ts` and executed. Two non-trivial workarounds were required:
  - `buildSealedSnapshot.ts` starts with `import "server-only"` which throws when imported outside a React Server Component. Stubbed via `/tmp/server-only-stub.cjs` (a `Module.prototype.require` hook that returns `{}` for the `server-only` package). Read-only and safe.
  - `tsx` could not resolve `@/` aliases or pnpm-symlinked modules from a script in `/tmp/`. Resolved by using absolute filesystem paths in the imports.
- **`buildSealedSnapshot` succeeded for Samaritus** despite the deal having no score, no concierge session, no borrower_applications, no feasibility study, and no trident bundle. **It produced a snapshot full of fallback zeros and empty strings** — observed exactly as the audit predicted from the `?? 0` and `?? "not_eligible"` defaults in the source.
- **`redactForMarketplace` THREW correctly** with the message: `"Cannot redact: band 'not_eligible' not rate-card-eligible. Sealing gate must reject before this."` This is **good behavior** — the redactor's protective gate prevents an ineligible deal from being marketplace-published. Fail-safe-NO is correct here.

**`forRedactor` actual values (annotated):**

| Field | Value | Source / fallback |
|---|---|---|
| `deal.sba_program` | `"7a"` | inferred from `deal.deal_type` (default) |
| `deal.loan_amount` | `500000` | from `assumptions.loan_impact.loanAmount` ✓ matches Stage 3 |
| `deal.term_months` | `120` | from `assumptions.loan_impact.termMonths` ✓ matches Stage 3 |
| `deal.state` | `""` | `deal.state` is null/empty in the row → empty string fallback |
| `deal.use_of_proceeds` | `[]` | from `pkg.use_of_proceeds` (Stage 7 — empty) |
| `deal.equity_injection_amount` | `0` | from `pkg.sources_and_uses.equityInjection.amount` (Stage 7 — empty) |
| `score.score` | `0` | **`?? 0` fallback — score is null** |
| `score.band` | `"not_eligible"` | **`?? "not_eligible"` fallback — score is null** (this is what blocked the redactor — by accident, the fallback happens to be the safe value) |
| `score.rateCardTier` | `"widest"` | **`?? "widest"` fallback** |
| `score.scoreComponents.*` | all 0 | all `?? 0` fallbacks |
| `score.eligibility.passed` | `false` | **`?? false` fallback — no eligibility data** |
| `score.eligibility.checks` | `[]` | empty — no diagnostics for why eligibility failed |
| `borrower.fico_score` | `null` | borrowerFin row missing |
| `borrower.liquid_assets` | `null` | borrowerFin row missing |
| `borrower.net_worth` | `null` | borrowerFin row missing |
| `borrower.years_in_operation` | `null` | no `YEARS_IN_BUSINESS` fact |
| `borrower.industry_experience_years` | `null` | borrowerFin row missing |
| `borrower.industry_naics` | `""` | `String(app?.naics ?? "")` → empty string |
| `borrower.industry_description` | `""` | same |
| `financials.dscr_base_historical` | `null` | no `DSCR` fact |
| `financials.dscr_base_projected` | `7.0262` | from `pkg.dscr_year1_base` ✓ |
| `financials.dscr_stress_projected` | `4.5093` | from `pkg.dscr_year1_downside` ✓ |
| `financials.global_cash_flow_dscr` | `null` | from `pkg.global_dscr` ✓ |
| `franchise` | `null` | feasibility row missing → `is_franchise=false` → null is correct |
| `feasibility.composite_score` | `0` | **`?? 0` fallback** |
| `feasibility.{market_demand,location_suitability,financial_viability,operational_readiness}_score` | all 0 | all `?? 0` fallbacks |
| `packageManifest.businessPlanPages` | `0` | **HARDCODED** at [buildSealedSnapshot.ts:215](src/lib/brokerage/buildSealedSnapshot.ts#L215) |
| `packageManifest.projectionsPages` | `0` | **HARDCODED** at [buildSealedSnapshot.ts:216](src/lib/brokerage/buildSealedSnapshot.ts#L216) |
| `packageManifest.feasibilityPages` | `0` | **HARDCODED** at [buildSealedSnapshot.ts:217](src/lib/brokerage/buildSealedSnapshot.ts#L217) |
| `packageManifest.formsIncluded` | `["1919", "413", "159"]` | **HARDCODED** at [buildSealedSnapshot.ts:218](src/lib/brokerage/buildSealedSnapshot.ts#L218) |
| `packageManifest.sourceDocumentsCount` | `0` | **HARDCODED** at [buildSealedSnapshot.ts:219](src/lib/brokerage/buildSealedSnapshot.ts#L219) |

**`piiContext` actual values:**

| Field | Value |
|---|---|
| `borrowerFirstName` | `null` |
| `borrowerLastName` | `null` |
| `businessLegalName` | `null` |
| `businessDbaName` | `null` |
| `city` | `null` |
| `zip` | `null` |

All-null because `borrower_applications` row is missing. **The PII scanner backstop has nothing to redact** — but it also has nothing leaked to redact, because the borrower data isn't here.

**Issues filed:**

- **[P0] `buildSealedSnapshot` silently fabricates score data when no score row exists.** The defaults at [buildSealedSnapshot.ts:166-186](src/lib/brokerage/buildSealedSnapshot.ts#L166-L186) (`score: { score: 0, band: "not_eligible", rateCardTier: "widest", ... eligibility: { passed: false, checks: [] } }`) make it possible to call `buildSealedSnapshot` for any deal regardless of state. **Today, `band: "not_eligible"` happens to be the redactor's gate-trip wire**, so an ineligible deal cannot accidentally seal. But this is a **fortunate coincidence** of how the fallback was named — if the fallback had been `"unknown"` or `"pending"`, the redactor's check at line 158 would not catch it, and a fabricated all-zeros KFS would be produced. **Recommended fix:** `buildSealedSnapshot` should `throw` when any required producer (score, feasibility, package, trident) is missing. Defensive defaults belong in the per-call surface (UI showing "Score not yet computed"), not in the snapshot assembler. (1-day fix + add asserts + integration test that snapshotting an incomplete deal raises.)
- **[P0] Five hardcoded values in `packageManifest`.** `businessPlanPages: 0`, `projectionsPages: 0`, `feasibilityPages: 0`, `formsIncluded: ["1919", "413", "159"]`, `sourceDocumentsCount: 0` — none are computed from real data. Even when a real Trident bundle exists, the manifest's page counts will report **zero**. The forms list is a static array regardless of which forms are actually in the bundle. **This will silently lie in the marketplace KFS** about how many pages of business plan / projections / feasibility a lender is buying access to. **Recommended fix:** wire each of the five fields to its real source — page counts from the Trident bundle's PDF metadata, forms-included from the actual forms manifest, `sourceDocumentsCount` from `deal_documents` count. (1–2 day subtask.)
- **[P1] Score fallbacks (`?? 0` and `?? "not_eligible"`) leak past the redactor when the score is genuinely missing.** Even if [P0] above is fixed (throw on missing producers), there's a subtler issue: a future change to the fallback values (e.g., renaming `"not_eligible"` to `"pending_review"`) would silently disable the redactor's gate at line 158. **Recommended fix:** add a CI guard / type-level invariant that the `band` fallback string must be in the rate-card-ineligible bucket. (Half-day.)
- **[P1] PII context all-null because applicant data is missing.** Not a redactor bug per se, but if the missing-applicant root cause is fixed (Stage 1/2 P0s), the PII context will start populating. The `select("*")` on `borrower_applications` already correctly handles missing columns ("PII context. Some columns don't exist on this schema..." — the source comment at line 222-225 admits the table doesn't have first/last name columns). **Recommended fix:** confirm whether `borrower_applications` should have `applicant_first_name` / `applicant_last_name` columns or whether those should come from `borrower_applicants`. Update either the schema or the loader. (Half-day investigation.)
- **[OBSERVATION — POSITIVE]** The redactor's gate at line 158 (`Cannot redact: band 'X' not rate-card-eligible`) is the **first piece of authoritative correctness behavior the audit has surfaced.** It correctly fail-safe-NOs when given a snapshot for an ineligible deal. This is the kind of guard the rest of the pipeline needs more of.
- **[OBSERVATION]** DSCR values flowed through cleanly from `buddy_sba_packages` to `forRedactor.financials` (7.0262 base, 4.5093 stress). Confirms the package → snapshot wiring works for that subset of fields, even when the rest is missing. **Audit script and stub `/tmp/server-only-stub.cjs` will be left in `/tmp/` — they are outside the repo tree, no commit risk, OS reboot wipes them.**

### Stage 12 — Rate card lookup

**Status:** **partial** (cannot run a real lookup — Samaritus has no eligible band — but rate card is inspectable globally)

**Findings:**

- The `redactForMarketplace` step at Stage 11 threw before producing a KFS, so the audit cannot do a real Samaritus rate-card lookup with band+program+loan_tier+term_tier from a redacted KFS.
- Inspected the rate card directly. **44 rows total**, all `version='1.0.0'`, all `superseded_at IS NULL`. Notes column is universally `'PLACEHOLDER'` (or `'PLACEHOLDER — counsel review required'` for one row). **Counsel review is still pending** — expected per spec.
- **4 score bands** have rate-card rows: `institutional_prime`, `selective_fit`, `specialty_lender`, `strong_fit`. **No `not_eligible` rows** — correct (don't price an ineligible deal). Whether the scoring engine has more bands (e.g., `borderline`, `below_threshold`) and whether those would need rate-card rows is a question for [src/lib/score/scoringCurves.ts](src/lib/score/scoringCurves.ts).
- **Tier coverage per (band, program):**

| band | 7a | 504 | express |
|---|---|---|---|
| institutional_prime | 8 rows (4 loan × 2 term) | 2 rows (2 loan × 1 term=`>15yr`) | 1 row (`<350K` × `<=7yr`) |
| selective_fit | 8 rows | 2 rows | 1 row |
| specialty_lender | 8 rows | 2 rows | 1 row |
| strong_fit | 8 rows | 2 rows | 1 row |

- **Tier gaps detected** (rows that would 404):
  - 7a × `>15yr` term — no rows. A 25-year 7a (real-estate-collateralized) is a real product. **gap**.
  - 504 × `<=7yr` and 504 × `7-15yr` — no rows. A 10-year 504 (equipment) is real. **gap**.
  - 504 × `<350K` and 504 × `350K-1M` — no rows. **gap** (504 minimum is typically $125k or so).
  - express × `350K-1M` and `1M-5M` and `>5M` — no rows. Express max is $500k so `350K-1M` exists in reality. **gap**.
  - express × `7-15yr` and `>15yr` — no rows. Express terms can extend. **gap**.
- **Hypothetical Samaritus lookup** (if band were `strong_fit`): `7a × 350K-1M × 7-15yr` → row exists with `spread_bps_over_prime=325, notes='PLACEHOLDER'`. If band were `institutional_prime`: 275 bps. If `selective_fit`: 375 bps. If `specialty_lender`: 450 bps. All four band-eligible permutations of Samaritus's parameters have rows.
- **For Samaritus's actual current band (`not_eligible`):** the redactor blocks before lookup, so this is moot. But: the rate-card lookup would otherwise return 0 rows for Samaritus's actual band, which is the intended behavior.

**Issues filed:**

- **[P1] Rate card has tier coverage gaps that will produce 404 lookups for valid SBA deals.** Specifically: 7a `>15yr`, 504 `<=7yr` and `7-15yr` and small loan tiers, express above `<350K` or `<=7yr`. **Recommended fix scope:** transcribe the missing tiers from counsel-reviewed pricing. Add a CI guard that asserts the rate card is dense across all deal-shape combinations the score engine can produce. (1 day for transcription + half-day for guard.)
- **[P1] All rate-card rows have `notes='PLACEHOLDER'`.** Expected per spec, but worth tracking — no deal can be confidently sealed until counsel review is complete. **Recommended fix scope:** counsel-review milestone, then a single migration to update notes. (No engineering work; tracking only.)
- **[OBSERVATION]** Score-band ↔ rate-card-band coverage is consistent: the 4 bands present in the rate card match the 4 rate-card-eligible bands. Once the scoring engine starts producing scores, the rate card will accept any score that lands in those bands.
- **[OBSERVATION — POSITIVE]** For the hypothetical Samaritus profile (`7a × 350K-1M × 7-15yr`), all 4 band-eligible permutations have rate-card rows. Samaritus's parameters are not in a tier-coverage gap.

---

## Master punchlist

### P0 (launch blockers — 13)

1. **`buddy_sba_scores` is globally empty** (Stage 4) — score worker has produced nothing for any deal. Sealing gate cannot pass for any deal. Investigation ticket of its own.
2. **`borrower_concierge_sessions` table is globally empty** (Stage 1) — concierge intake produces no sessions. Single root-cause investigation joined with #1, #3.
3. **`borrower_applications` / `borrower_applicants` / `borrower_applicant_financials` all globally empty** (Stage 2) — borrower data not persisted. Score loader's borrower-strength dimension can never receive inputs.
4. **No feasibility study generated for Samaritus** (Stage 6) — generator has not run for this deal. Subtask of #1 root-cause family.
5. **No trident bundle generated for Samaritus, table globally empty** (Stage 9) — Sprint 5's bundle producer has zero observable activity. Subtask of #1 root-cause family.
6. **Eligibility engine silently passes use-of-proceeds when both inputs are empty** (Stage 7 → cross-cuts to Stage 5) — `collectUopText` produces truthy `"{}"`, regex doesn't match, check passes. Fix: only push `JSON.stringify(sourcesAndUses)` if it has at least one own property.
7. **Samaritus package has empty `use_of_proceeds = []` and empty `sources_and_uses = {}`** (Stage 7) — package generator produces a package without UoP/S&U. Either populate from assumption data or fail generation.
8. **Income-statement waterfall does not reconcile** (Stage 8) — Σ(opex line items) ≠ `TOTAL_OPERATING_EXPENSES`; `revenue − COGS − OpEx ≠ OPERATING_INCOME`. Add a post-extraction validator.
9. **Four `personalIncomeExtractor:v2:deterministic` ocr_regex extractions wrote `0` when the regex matched form instruction text** (Stage 8) — ADJUSTED_GROSS_INCOME 2025, SCH_E_DEPRECIATION 2023+2025, TOTAL_TAX 2025. Fix: reject any "extracted value" whose snippet contains alphabetic characters; persist as null + `resolution_status='extraction_failed'` instead of 0.
10. **Balance sheet missing AR, Inventory, Total Current Assets, Total Current Liabilities** (Stage 8) — current/quick ratios cannot be computed. Add to extractor as required fields.
11. **`buildSealedSnapshot` silently fabricates score data when no score row exists** (Stage 11) — `?? 0` and `?? "not_eligible"` defaults. Should throw when required producers are missing. Fortunate coincidence that the band fallback happens to be a redactor-blocked value; future renames could disable the gate.
12. **Five hardcoded values in `packageManifest`** (Stage 11) — page counts and forms list are static literals. Will silently lie in marketplace KFS about what a lender is buying access to.
13. **No path exists today to ever satisfy `canSeal()`** (Stage 4) — direct consequence of #1. Filed separately for tracking; same fix.

### P1 (quality — 18)

14. **Score computes silently when all four borrower-strength inputs are null** (Stage 2) — pushes onto `missing[]` but doesn't gate computation. Evaluate at Stage 4 once score worker runs; possible escalation to P0.
15. **Two parallel `ALLOWED_FACT_KEYS` definitions** with near-zero overlap (12 vs. 44 keys, share only `naics_code` + `annual_revenue`) (Stage 1).
16. **Test-fixture name leak in `deals.name` and `deals.borrower_name`** (Stage 1) — `"ChatGPT Fix 15"` while `display_name` is `"Samaritus Yacht Management"`. P0 escalation path if leaky columns reach the redactor.
17. **Fixture-flavor labels in authoritative assumptions** (Stage 3) — `revenue_streams[0].id="canary_stream_1"`, `management_team[0].name="Test Borrower"`. P0 escalation path if narrative builders surface them.
18. **Management-team bio mismatches business** (Stage 3) — yacht-management deal has principal described as "property management and commercial real estate". Add narrative-coherence validation gate.
19. **Three of nine SOP eligibility categories are scaffolded** (Stage 5) — `passive_business`, `pyramid_mlm`, full `real_estate_speculation`. Sprint of its own.
20. **Size-standards table is top-50 NAICS only (PLACEHOLDER)** (Stage 5) — yacht/marine/agriculture/heavy-industry will all default-deny.
21. **Two parallel SBA-eligibility engines** (Stage 5) — `evaluateSbaEligibility` (legacy, 11 consumers) and `evaluateBuddySbaEligibility` (new). Consolidation.
22. **Revenue growth in projections (12.5%) does not match assumption inputs** (Stage 7) — neither `0.08+0.05` nor `(1.08)(1.05)−1` produces 0.125. Trace projector and add reproducibility CI guard.
23. **8 of ~12 narrative columns NULL on package** (Stage 7) — `executive_summary`, `industry_analysis`, `plan_thesis`, `marketing_strategy`, `operations_plan`, all SWOTs, `franchise_section`, `sensitivity_narrative`. Wire narrative builders into package generation.
24. **Base-year COGS percentage (33%) does not match assumption (29%)** (Stage 7) — surface as a `package_warnings` entry when extraction-derived base year diverges from assumed.
25. **`package_warnings` and `benchmark_warnings` empty despite multiple anomalies** (Stage 7) — warning generator either didn't run or doesn't cover these checks.
26. **`_IS` suffix inconsistently applied** (Stage 8) — 5 keys have it, 8 don't. Standardize via migration + CI guard.
27. **Name drift between expected MMAS keys and persisted keys** (Stage 8) — REVENUE/TOTAL_REVENUE, COGS/COST_OF_GOODS_SOLD, SL_PPE/SL_PPE_GROSS, etc. Publish canonical mapping.
28. **EBITDA / EBIT not persisted as facts** (Stage 8) — only in `buddy_sba_packages.base_year_data` JSONB. Compute and persist as derived facts.
29. **`DEPRECIATION` fact (83,883) ≠ package `base_year_data.depreciation` (30,650)** (Stage 8) — two authoritative sources disagree on Y0 value.
30. **Score fallback values (`?? 0`, `?? "not_eligible"`) leak past redactor** (Stage 11) — even if #11 is fixed, future fallback renames could silently disable the redactor's gate. Add a CI guard.
31. **PII context all-null because applicant data is missing** (Stage 11) — Confirm whether `borrower_applications` should have first/last name columns or whether they belong on `borrower_applicants`.
32. **Rate card has tier coverage gaps** (Stage 12) — 7a `>15yr`, 504 `<=7yr` and `7-15yr`, 504 small loan tiers, express above `<350K` or `<=7yr`. Will produce 404 lookups for valid SBA deals.
33. **All rate-card rows still `notes='PLACEHOLDER'`** (Stage 12) — counsel review pending. Tracking only.

### P2 (nice-to-have — 7)

34. Spec v1.1 documentation drift across stages 1, 2, 6, 8, 11 — `last_activity_at` (doesn't exist), "21 ALLOWED_FACT_KEYS" (actual: 12 or 44), `borrower_applicant_financials.deal_id` (doesn't exist), `generation_status`/`generated_at` columns wrong on feasibility, `fact_period`/`fact_year`/`source` column names. Single edit pass for v1.2.
35. `margin_of_safety_pct` field uses Year-1 projected revenue (not base year). Mathematically defensible, but unintuitive given the field name. Cosmetic rename.
36. Package `status='draft'` despite deal at `stage='underwriting'`. Lifecycle/package state desynced.
37. 12 `P2_VERIFY_LEGITIMATE_ZERO` + 3 `P2_VERIFY_LEGITIMATE_ZERO_NUMERIC` zeros across PFS, K1s, QBI, etc. Spot-check 2-3 manually against source documents.
38. Two extractors (`gemini_primary_v1` and `personalIncomeExtractor:v2:deterministic`) write the same fact_key for the same period — confirm intent (supersede vs. cross-check) and validate `is_superseded` flag-setting.
39. `projections_xlsx_path` column on `buddy_trident_bundles` not in spec v1.1 — confirm whether XLSX is part of the formal Trident bundle contract.
40. Score-band ↔ rate-card-band coverage check — confirm scoring engine has only the 4 bands the rate card supports, or that overflow bands are intentionally non-priced.

---

## Provenance summary (Stage 8 specific)

| Provenance flag | Count | Sample fact_keys |
|---|---:|---|
| OK | 150 | TOTAL_REVENUE, GROSS_PROFIT, SALARIES_WAGES_IS, SL_CASH, SL_TOTAL_ASSETS |
| **P0_LOW_CONFIDENCE_ZERO** | **4** | ADJUSTED_GROSS_INCOME 2025, SCH_E_DEPRECIATION 2023, SCH_E_DEPRECIATION 2025, TOTAL_TAX 2025 — all extractor-instruction-text fallbacks |
| P2_VERIFY_LEGITIMATE_ZERO | 12 | DEPRECIATION (1 of 4), K1_ORDINARY_INCOME_2 (1 of 3), K1_ORDINARY_INCOME_3 (1 of 3), PFS_CONTINGENT_LIABILITIES, PFS_IRA_401K, PFS_LIFE_INS_CSV, PFS_LIFE_INS_LOAN, PFS_UNPAID_TAXES, QBI_DEDUCTION (3), TAXABLE_INCOME (1), TOTAL_TAX (2) |
| P2_VERIFY_LEGITIMATE_ZERO_NUMERIC | 3 | Zeros whose extracted snippet is `"0."` (a real "0." on the form) |
| P1_MISSING_PROVENANCE | 0 | (none — every Samaritus fact has provenance JSONB) |
| P1_MISSING_EXTRACTOR_TAG | 0 | (none) |

---

## Recommended fix sequence

1. **Single-day root-cause investigation across the upstream producers** (P0 #1–5). Concierge sessions, applicant data, score worker, feasibility worker, trident worker — five tables empty for Samaritus, four globally empty. Likely a single trigger-condition or RLS or worker-runner fix that unlocks all five. Trace the lifecycle stage transitions and the worker entry points; verify they're being called. This unblocks every other stage.
2. **Surgical correctness fixes within the existing code paths** (P0 #6, #8, #9, #11, #12). These are bounded changes, each ≤ 2 days, and each closes a specific silent-fallback path:
   - Empty-input UoP eligibility bug
   - Income-statement waterfall validator
   - Personal-income extractor instruction-text rejection
   - `buildSealedSnapshot` throw-on-missing-producers
   - `packageManifest` real values instead of hardcoded zeros
3. **Data-integrity backstops** (P0 #7, #10). Empty UoP/S&U on the package and missing BS line items. Both are extractor coverage gaps that need the producer to populate, not the consumer to defend against. Pair with the Stage 1/2 root-cause work.
4. **Quality / narrative coherence** (P1 #14–25). Once the upstream producers are running and the surgical fixes are in, this is the layer that determines whether outputs are *trustworthy* — fixture-name leaks, mismatched bios, parallel fact-key registries, narrative completeness. Best done in a dedicated quality sprint after #1–3 land, since findings will refine.
5. **Spec / documentation hygiene + rate-card tier coverage + counsel review** (P1 #32–33, P2 across the board). Lower priority — none of these block correctness. Defer to after #1–4 ship.

---

## Open questions for Matt

1. **Is the borrower-side data (concierge sessions, applications, applicants, applicant financials) supposed to be empty in this DB?** If this is a fresh dev/staging instance and borrower flow has never run here, several P0 findings collapse to "operational, not architectural." If it's a production-shaped instance, those P0s remain. The audit cannot distinguish without your confirmation.
2. **What's the authoritative trigger condition for the score worker?** Five tables are globally empty (`buddy_sba_scores`, `buddy_trident_bundles`, `buddy_validation_reports`, `borrower_applications`, `borrower_concierge_sessions`). One root cause likely explains all five. Knowing whether they're triggered by lifecycle stage, by manual recompute, or by a cron job is the fastest path to the fix.
3. **Are EBITDA / EBIT / ratios deliberately not persisted as `deal_financial_facts` rows?** Architectural choice (compute at render time) or extractor coverage gap? Affects whether MMAS-coverage finding is a P1 (gap) or no-action (by design).
4. **Is `evaluateBuddySbaEligibility` (Sprint 0 era) intended to permanently coexist with `evaluateSbaEligibility` (legacy, 11 consumers), or should one supersede?** Affects how to file the consolidation ticket.
5. **Should the rate card eventually have tiers for 7a `>15yr`, 504 short-term, and broader express?** If yes, this is real underwriting work for counsel. If not, the gaps need explicit "not priced" rows or a guard at lookup time.
6. **For the test-fixture name leak (`name='ChatGPT Fix 15'`), should the redactor reject deals whose `name` or `borrower_name` doesn't match `display_name` patterns?** P0 if test fixtures can flow through to a sealable state; P1 cleanup if they're caught earlier.

---

## Audit hygiene notes

- Audit script `/tmp/audit-snapshot.ts` and stub `/tmp/server-only-stub.cjs` — both outside the repo tree, no commit risk, OS reboot wipes them. Verified `git status` shows no `.ts`, `.cjs`, or `.js` file under `scripts/` or anywhere in the repo tree.
- All findings written to this file inline as each stage completed (no in-context accumulation, no end-of-audit batch write).
- All SQL queries used the corrected deal_id `0279ed32-c25c-4919-b231-5790050331dd`. Spec v1.1's `ffcc9733-...` is not in the database.
- Read-only audit. No production data modified. No new application code. Single deliverable: this document.











