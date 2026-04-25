# Sprint 6B — Golden Deal Run (end-to-end pipeline execution)

**Procedure / spec.** Durable artifact. Re-runnable as a regression harness whenever a new release lands.

> **This run is expected to fail.** The goal is not success — it is to surface the true state of the pipeline. A run that completes Stage 12 with green checkmarks but vague evidence is less valuable than a run that halts at Stage 4 with sharp diagnostic findings. Operators should resist the natural pull to "make stages pass." If a producer doesn't fire, document precisely what happened and continue (or halt per matrix below). Don't fix inline. Don't paper over.

---

## Naming convention

| Artifact | Path | Frequency |
|---|---|---|
| **Spec (this file — the procedure)** | `specs/brokerage/sprint-06b-golden-deal-run.md` | Written once, evolves via amendments |
| **Run results (the trace)** | `specs/brokerage/golden-deal-run-YYYY-MM-results.md` | One file per run, dated, never overwritten |

Note on the "06b" suffix: there is already a `sprint-06-marketplace-and-pick.md` on `main` (the planned post-Sprint-5 marketplace + claim work). This spec is part of the **Sprint 6 audit cluster** introduced 2026-04:

- **Sprint 6A** — underwriting audit (read-only). Deliverable: `specs/brokerage/underwriting-audit-2026-04.md` (currently on PR #342, branch `audit/underwriting-2026-04`).
- **Sprint 6B** — Golden Deal Run (this spec). Read-write against a dedicated test deal.
- **Sprint 6C** — P0 fix sprint scoped against the Golden Deal Run's findings, not the audit's predictions.
- **Sprint 6D** — quality sprint for the P1s.

---

## Run metadata block (operator fills before starting)

Every run begins with the operator filling out this block. It anchors the run to a specific code state and environment.

```md
## Run Metadata
- Run ID: golden-deal-YYYY-MM-DD
- Environment: <preview-url-or-staging-url>
- Branch executed against: main (or fork name)
- Commit SHA: <git rev-parse HEAD>
- Operator: Claude Code / Matt / [other]
- Run start: <ISO timestamp>
- Run end: <ISO timestamp>
- Test deal name: Madison Bagel Co (Golden Run)
- Test deal ID: <captured at Stage 1>
```

If the run is restarted partway through (e.g., halted at Stage 4, fixed, resumed), the operator fills in a new block in the same results file with `Run ID: golden-deal-YYYY-MM-DD-resume-N`. Each block has its own start/end timestamps and SHA. Don't fold resumed-runs into the original metadata.

---

## Why this exists

The 2026-04-25 underwriting audit (`specs/brokerage/underwriting-audit-2026-04.md`, PR #342) revealed that the dev DB has never seen a deal flow end-to-end. 5 of 12 pipeline tables are globally empty. Six of the audit's 13 P0 findings were predictions about what would break, not observations of real failures, because the producers were never triggered.

The Golden Deal Run produces three artifacts:

1. **Baseline truth.** At every transition: what tables get written to, what their values look like, what fails. Captured in real time.
2. **Audit prediction validation.** Which P0s reproduce on a real run, which don't, and what new failures emerge that the audit missed.
3. **A fixture replacing the hand-seeded "ChatGPT Fix N" pattern.** The deal created by this run becomes the canonical "real flow" reference for future audits.

This is **not a smoke test**. A smoke verifies wiring works. The Golden Deal Run instruments the pipeline, captures state at every transition, and produces analysis. It's an integration audit with active driving.

---

## Pre-flight verification (HALT until all four pass)

Operator MUST NOT start the run until all four prerequisites are confirmed. Each is verifiable; no assumptions.

### 1. Fly gateway redeploy

The Sprint 2 voice gateway has not been redeployed since the merge. Until this happens, voice transcripts won't dispatch to `confirmed_facts`, and the run cannot exercise the voice path.

**Action (Matt):**
```bash
cd buddy-voice-gateway/
fly deploy -a buddy-voice-gateway
fly logs -a buddy-voice-gateway   # watch for clean startup
```

**Verification (operator):**
```bash
fly status -a buddy-voice-gateway
# Look for: Status=running, recent deployment timestamp (today or yesterday)
```

If status shows a deployment older than 5 days OR Status≠running, **HALT** and flag.

### 2. Sprint 5 PR #341 merged + SealPackageCard wired

Until merged, the Golden Deal Run cannot exercise sealing. Until SealPackageCard is wired into `/start`, the borrower-side sealing path doesn't have a UI surface.

**Action (Matt):** wire the one-line `<SealPackageCard dealId={dealId} />` into the appropriate `/start` client component (on `main` today, that's `src/app/start/StartConciergeClient.tsx` — `/start` lives at `src/app/start/`, not under a route group), push, approve, merge.

**Verification (operator):**
```bash
gh pr view 341 --json state -q .state
# Expected: "MERGED"

git grep -l "SealPackageCard" src/components src/app
# Expected: at least one file in src/app/ in the result
```

If PR is not merged OR SealPackageCard is not imported anywhere in `src/app` or `src/components`, **HALT** and flag.

### 3. Vercel preview URL identified

The run executes against a real preview, not localhost. Production is off-limits.

**Action (Matt):** confirm a stable preview URL pointing at a recent main commit.

**Verification (operator):**
```bash
curl -sI https://<preview-url>/start | head -1
# Expected: HTTP/2 200
```

### 4. Pre-flight DB sanity check

Confirm the dev DB hasn't drifted further since the audit. The 5 globally-empty tables should still be empty (proving no stealth fixture was added between audit and this run).

```sql
SELECT
  CASE WHEN (SELECT count(*) FROM buddy_sba_scores) = 0 THEN '✓' ELSE '✗ unexpected scores' END AS scores,
  CASE WHEN (SELECT count(*) FROM buddy_trident_bundles) = 0 THEN '✓' ELSE '✗ unexpected bundles' END AS bundles,
  CASE WHEN (SELECT count(*) FROM buddy_validation_reports) = 0 THEN '✓' ELSE '✗ unexpected validations' END AS validations,
  CASE WHEN (SELECT count(*) FROM borrower_concierge_sessions) = 0 THEN '✓' ELSE '✗ unexpected sessions' END AS sessions,
  CASE WHEN (SELECT count(*) FROM borrower_applications) = 0 THEN '✓' ELSE '✗ unexpected applications' END AS applications;
```

Any `✗` means the DB has changed since the audit. **HALT**, document the change, ask Matt before proceeding (the change might be intentional, e.g., an exploratory test someone ran, or might indicate that another pipeline run already happened that we should examine first).

---

## Test deal definition

**Do NOT use Samaritus.** Samaritus is the audit's reference deal; reusing it pollutes both the audit baseline and this run's signal. **Do NOT use any "ChatGPT Fix N" deal.** Those are stale fixtures.

Create a fresh deal via the `/start` brokerage front-door with the following profile:

```
Business: Madison Bagel Co (synthetic — does not match any real franchise)
Concept: bagel shop, owner-operator, single location
Loan ask: $425,000 SBA 7(a), 10-year term
Use of proceeds: equipment $185k, working capital $90k, leasehold improvements $130k, fees $20k
Borrower:
  Name: Test Borrower (Golden Run)
  Industry experience: 8 years (managed retail food previously)
  FICO: 745
  Liquid assets: $95,000
  Net worth: $340,000
  Equity injection: $55,000 (~13% of total project)
Location: Madison, Wisconsin (state matters — Sprint 4 broker license review starts there)
NAICS: 311812 (Commercial Bakeries) OR 722515 (Snacks & Nonalcoholic Beverage Bars)
  — Operator picks whichever exists in the size-standards table; if neither does, file as confirmation of P1 #20
DSCR target: ~1.50x base (Sprint 0 minimum is 1.20)
Real franchise: NO — explicitly non-franchise to avoid franchise-resolution path complexity
```

Why this profile:
- Concrete enough that the concierge can extract real facts (not "loan for a business")
- Loan amount lands in `350K-1M` rate-card tier, term in `7-15yr` — exists in the rate card
- FICO/liquidity/net worth all in mid-tier buckets, not the boundary edge cases
- Wisconsin matches the state Sprint 4 starts with for broker licensing
- Non-franchise avoids the franchise-resolution placeholder block (separate concern)
- "Madison Bagel Co" does not collide with any real business; safe synthetic identity

If any field is rejected by an upstream validator that's stricter than the spec assumed, document it as a finding and pick a workable adjustment. Do not fight validators — note the finding and proceed.

---

## Architecture invariants

1. **One deal, end-to-end.** Single deal_id from creation to sealed listing. Do not branch. Do not skip stages. If a stage fails, pause and document, don't reroute.
2. **DB capture at every transition.** Before and after each stage, snapshot the relevant tables for this deal_id. The deliverable is the trace, not just the final state.
3. **No production data modified.** Every write is to the new test deal. Samaritus and the 10 "ChatGPT Fix" deals must not be touched.
4. **No code changes during the run.** If a stage fails, document the failure as a finding and either skip the stage (continuing where possible) or halt the run. Do not write fixes inline. Fixes are Sprint 6C scope.
5. **Real workers, real APIs, real Gemini calls.** No mocking. The point is to exercise the actual production-shape pipeline.
6. **Results are appended in real-time.** Write stage results to the results file as each stage completes. Do not accumulate in context.

---

## The run — 13 stages (0–12)

Each stage has the same structure: trigger condition, expected outputs, capture queries, evaluation criteria, findings to file.

### Stage 0 — Pre-run snapshot

Before any action, snapshot global pipeline state. This is the baseline against which "what changed" is measured.

```sql
SELECT
  'pre_run_baseline' AS marker,
  now() AS captured_at,
  (SELECT count(*) FROM deals) AS deals_count,
  (SELECT count(*) FROM borrower_concierge_sessions) AS sessions_count,
  (SELECT count(*) FROM borrower_applications) AS applications_count,
  (SELECT count(*) FROM borrower_applicants) AS applicants_count,
  (SELECT count(*) FROM borrower_applicant_financials) AS financials_count,
  (SELECT count(*) FROM buddy_sba_assumptions) AS assumptions_count,
  (SELECT count(*) FROM buddy_sba_packages) AS packages_count,
  (SELECT count(*) FROM buddy_sba_scores) AS scores_count,
  (SELECT count(*) FROM buddy_feasibility_studies) AS feasibility_count,
  (SELECT count(*) FROM buddy_trident_bundles) AS bundles_count,
  (SELECT count(*) FROM buddy_validation_reports) AS validations_count,
  (SELECT count(*) FROM buddy_sealed_packages) AS sealed_count,
  (SELECT count(*) FROM marketplace_listings) AS listings_count,
  (SELECT count(*) FROM deal_financial_facts) AS facts_count;
```

Save the snapshot row to the results file as Stage 0 baseline.

### Stage 1 — Borrower intake via `/start` (chat path)

**Trigger:** Open `<preview-url>/start` in a fresh browser session (no existing cookies). Send a single chat message that introduces the borrower's intent: roughly "I'm looking at opening a bagel shop in Madison, Wisconsin and need to understand SBA financing options."

This should:
- Mint a new deal in `deals` table
- Mint a new `borrower_concierge_sessions` row
- Set `buddy_borrower_session` cookie

**Capture before sending message:**
```sql
SELECT max(created_at) FROM deals;
SELECT max(created_at) FROM borrower_concierge_sessions;
```

**Capture after Buddy responds:**
```sql
-- The new deal
SELECT id, bank_id, deal_type, origin, display_name, name, borrower_name, stage, status, created_at
FROM deals
WHERE created_at > '<pre_message_timestamp>'
ORDER BY created_at DESC
LIMIT 5;

-- The new concierge session
SELECT id, deal_id, created_at, updated_at,
  jsonb_pretty(confirmed_facts) AS confirmed_facts,
  jsonb_pretty(extracted_facts) AS extracted_facts,
  conversation_history
FROM borrower_concierge_sessions
WHERE created_at > '<pre_message_timestamp>'
ORDER BY created_at DESC;
```

**Save the new deal_id as `<RUN_DEAL_ID>` for use in every subsequent stage.**

**Evaluation:**
- Deal row exists? Are `name` and `borrower_name` populated correctly, or do they default to fixture-flavor strings? (P1 #16 verification)
- Concierge session created with the same deal_id?
- Did the chat assistant produce a sensible response, or did the route 500?
- `confirmed_facts` populated with the intent (loan amount, location), or empty?
- `extracted_facts` populated, or empty?

**Findings to file:**
- Any unexpected NULLs on the new `deals` row (especially `state`, `deal_type`, `origin`)
- Any difference between what the chat assistant claimed to "understand" and what landed in `confirmed_facts`
- If `borrower_concierge_sessions` is still empty after the chat round-trip, this is a P0 finding that REPRODUCES audit P0 #2

**Continue only if a deal_id and session_id are captured.** If neither exists, **HALT** the run — there's a deeper bug than the audit predicted.

### Stage 2 — Continue intake to capture all fact keys

Now drive the chat to populate as many of the 12 dispatch-route `ALLOWED_FACT_KEYS` as possible. Send 3–5 follow-up messages providing concrete facts:

> Message 2: "Loan amount around $425,000. 10-year term."
> Message 3: "I have 8 years of experience in retail food management. My FICO is 745. Liquid assets around $95,000."
> Message 4: "Net worth roughly $340,000. I plan to put in $55,000 of equity. The space I'm looking at is in Madison, Wisconsin."
> Message 5: "Use of proceeds: about $185k for equipment, $90k working capital, $130k leasehold, $20k closing costs."

After each message, capture the session's `confirmed_facts` evolution:

```sql
SELECT
  jsonb_pretty(confirmed_facts) AS confirmed_facts,
  jsonb_pretty(extracted_facts) AS extracted_facts,
  updated_at
FROM borrower_concierge_sessions
WHERE deal_id = '<RUN_DEAL_ID>';
```

**Evaluation:**
- Which keys land in `confirmed_facts` vs `extracted_facts`?
- Are facts that were obvious from the message (e.g., "FICO is 745") captured in `confirmed_facts.fico_estimate`, or only in `extracted_facts`?
- Any facts that should have been extracted but weren't?
- Any facts that landed but with wrong values (e.g., loan_amount captured as 4250 instead of 425000)?
- Per audit P1 #15: did the dispatch route extract any keys outside its 12 `ALLOWED_FACT_KEYS`? (suggests rogue extraction)

**Findings to file:**
- Per-key extraction quality observations
- Any obvious extraction failures (e.g., the chat assistant says "got it" but the value doesn't appear in the session)

### Stage 3 — Borrower applicant data capture

After intake produces enough confirmed_facts, the next pipeline stage is borrower application creation — `borrower_applications` + `borrower_applicants` + `borrower_applicant_financials`.

**Trigger:** **What triggers the application?** Best guesses:
- An explicit "Continue to application" CTA on `/start`
- A lifecycle stage transition once `confirmed_facts` reaches a completeness threshold
- A separate `/apply` route that the borrower navigates to manually

Operator: **investigate at the source.** Read `src/app/start/` (where the `/start` UI lives on `main` — note: ungrouped, NOT under a `(brokerage)` route group) and trace what UI action / lifecycle event creates a `borrower_applications` row. Document the trigger. Then exercise it.

**Capture after trigger:**
```sql
-- Did the application get created?
SELECT *
FROM borrower_applications
WHERE deal_id = '<RUN_DEAL_ID>'
ORDER BY created_at DESC;

-- Did applicants get created?
SELECT *
FROM borrower_applicants
WHERE application_id IN (
  SELECT id FROM borrower_applications WHERE deal_id = '<RUN_DEAL_ID>'
);

-- Did financials get created?
SELECT baf.*
FROM borrower_applicant_financials baf
JOIN borrower_applicants ba ON ba.id = baf.applicant_id
JOIN borrower_applications app ON app.id = ba.application_id
WHERE app.deal_id = '<RUN_DEAL_ID>';
```

**Evaluation:**
- Did the trigger produce all three rows?
- Are `confirmed_facts` from concierge session correctly mapped onto these tables? Specifically: did `fico_estimate` from concierge land in `borrower_applicant_financials.fico_score`?
- Per audit P1 #14: with applicant data now present, would the score still compute, or does it correctly gate?

**Findings to file:**
- Trigger condition for application creation (now documented for the first time)
- Mapping fidelity between concierge facts and application data
- Any fields that have to be filled out by the borrower in a separate form vs auto-mapped from concierge

**If no path exists from `/start` to a `borrower_applications` row:** that is a P0 finding. The pipeline has a missing link between intake and application. Document and continue with a manual SQL insert (using the captured `confirmed_facts` to construct realistic values) so downstream stages can still execute. Note the manual-insert clearly in the results file.

### Stage 4 — SBA assumptions confirmation

Once application data exists, the next stage is `buddy_sba_assumptions` confirmation. Trigger: likely the underwriter (banker-side) reviews and confirms assumptions in the cockpit, OR a borrower-side flow auto-confirms based on concierge facts.

**Trigger:** Investigate at source. Check `src/app/(app)/deals/[dealId]/underwrite/` for the assumptions surface — note the underwrite cockpit lives in the `(app)` route group on `main`. Either:
- Sign in as a banker (Clerk login required) to the Old Glory Bank tenant, navigate to the new deal's underwrite page, confirm assumptions
- Or trigger via API if a non-UI path exists

**Capture after trigger:**
```sql
SELECT
  status,
  confirmed_at,
  jsonb_pretty(loan_impact) AS loan_impact,
  jsonb_pretty(cost_assumptions) AS cost_assumptions,
  jsonb_pretty(working_capital) AS working_capital,
  jsonb_pretty(revenue_streams) AS revenue_streams,
  jsonb_pretty(management_team) AS management_team
FROM buddy_sba_assumptions
WHERE deal_id = '<RUN_DEAL_ID>';
```

**Evaluation:**
- `loan_impact.loanAmount = 425000` and `loan_impact.termMonths = 120`?
- `cost_assumptions` populated with sensible defaults for a bagel shop (vs Samaritus's yacht-management defaults)?
- `revenue_streams[0].id` — is it a generic ID (e.g., a UUID) or another fixture-flavor string like `"canary_stream_1"` (audit P1 #17)?
- `management_team[0].name` — is it the test borrower's name, or fixture-flavor "Test Borrower"?

**Findings to file:**
- Verify or refute audit P1 #17 (fixture labels in authoritative assumptions)
- Document whether assumption confirmation requires banker action or is auto-driven from concierge

### Stage 5 — Document upload + financial fact extraction

Real deals have source documents (tax returns, financial statements, personal financial statements). For the Golden Deal Run, we need to exercise extraction on at least one document so we can trace the path that produced the audit's 4 P0 instruction-text-fallback findings.

**Trigger:** Upload at least one document for the new deal. Options:
- A real anonymized tax return PDF (best — exercises the full extraction stack)
- A synthetic but format-correct PDF (acceptable — still exercises extraction)
- A skip-with-documentation outcome (worst — but acceptable if upload path is broken or no fixture is available)

If no test fixture is readily available, use one of the existing `deal_documents` rows as a template (read its content, copy to a new `deal_id`, document the workaround clearly).

**Capture during/after extraction:**
```sql
-- Watch the facts arrive
SELECT
  fact_key, fact_value_num, fact_value_text, fact_period, fact_year,
  CASE
    WHEN fact_value_num = 0 AND (provenance->>'snippet') ~ '[a-zA-Z]'
      THEN 'P0_INSTRUCTION_TEXT_FALLBACK'
    WHEN fact_value_num = 0 AND provenance->>'extractor_path' = 'ocr_regex'
      THEN 'P1_VERIFY_OCR_MATCH'
    ELSE 'OK'
  END AS provenance_flag,
  provenance->>'extractor' AS extractor,
  provenance->>'confidence' AS confidence,
  provenance->>'snippet' AS snippet
FROM deal_financial_facts
WHERE deal_id = '<RUN_DEAL_ID>'
ORDER BY provenance_flag, fact_key;
```

**Evaluation:**
- Did extraction fire?
- Any facts with `P0_INSTRUCTION_TEXT_FALLBACK` flag? (reproduces audit P0 #9)
- Are the BS-line-item gaps the audit identified (AR, Inventory, Total Current Assets, Total Current Liabilities) reproduced on this fresh extraction? (P0 #10)
- Does the IS waterfall reconcile? (P0 #8)

**Findings to file:**
- Per-extractor coverage (which extractors fired, which didn't)
- Provenance flag counts (mirror the audit's table format)
- IS waterfall reconciliation check using the new facts

### Stage 6 — SBA package generation

After assumptions confirmed and facts extracted, package generation should fire.

**Trigger:** This appears to fire automatically post-assumption-confirmation per audit Stage 7 finding ("8 seconds after assumptions confirmed"). If it does NOT fire automatically for the Golden Deal Run, that's a finding.

**Capture:**
```sql
SELECT
  id, version_number, status, generated_at,
  dscr_year1_base, dscr_year1_downside, global_dscr,
  jsonb_pretty(use_of_proceeds) AS use_of_proceeds,
  jsonb_pretty(sources_and_uses) AS sources_and_uses,
  jsonb_pretty(base_year_data) AS base_year_data,
  jsonb_pretty(projections_annual) AS projections_annual,
  package_warnings,
  benchmark_warnings,
  -- narrative columns
  CASE WHEN business_overview_narrative IS NOT NULL THEN 'populated' ELSE 'NULL' END AS overview,
  CASE WHEN executive_summary IS NOT NULL THEN 'populated' ELSE 'NULL' END AS exec_summary,
  CASE WHEN industry_analysis IS NOT NULL THEN 'populated' ELSE 'NULL' END AS industry,
  CASE WHEN plan_thesis IS NOT NULL THEN 'populated' ELSE 'NULL' END AS thesis,
  CASE WHEN swot_strengths IS NOT NULL THEN 'populated' ELSE 'NULL' END AS swot_s,
  CASE WHEN sensitivity_narrative IS NOT NULL THEN 'populated' ELSE 'NULL' END AS sensitivity
FROM buddy_sba_packages
WHERE deal_id = '<RUN_DEAL_ID>'
ORDER BY version_number DESC;
```

**Evaluation:**
- Did generation fire automatically?
- Is `use_of_proceeds` populated, or empty as in Samaritus? (reproduces P0 #7 if empty)
- Is `sources_and_uses` populated?
- Are narrative columns populated, or 8/12 NULL as in Samaritus? (P1 #23)
- DSCR math: does `dscr_year1_base` reconcile with revenue/expenses/debt service in `projections_annual[0]`?
- Does revenue growth match assumptions inputs? (P1 #22)
- Are `package_warnings` and `benchmark_warnings` populated this time? (P1 #25)

**Findings to file:**
- Per-finding reproduce/refute table for audit P0 #7, P1 #22, P1 #23, P1 #24, P1 #25

### Stage 7 — Buddy SBA Score computation

This is the load-bearing stage of the Golden Deal Run. Audit P0 #1 said scores are globally empty — meaning either the worker has never been triggered or it errors silently. The Golden Deal Run answers this definitively.

**Trigger:** Investigate. Likely candidates:
- Explicit "Recompute Score" button in the underwrite cockpit's ReadinessPanel
- Lifecycle stage transition into `score_ready` or similar
- Cron job (less likely but possible)

Read `src/lib/score/` and `src/app/(app)/deals/[dealId]/underwrite/` (note: `(app)` route group on `main`) to find the entry point. Document the trigger condition. Then exercise it.

**Capture:**
```sql
SELECT
  id, score, band, score_status, rate_card_tier, eligibility_passed,
  jsonb_pretty(borrower_strength) AS borrower_strength,
  jsonb_pretty(business_strength) AS business_strength,
  jsonb_pretty(deal_structure) AS deal_structure,
  jsonb_pretty(repayment_capacity) AS repayment_capacity,
  jsonb_pretty(franchise_quality) AS franchise_quality,
  jsonb_pretty(eligibility_failures) AS eligibility_failures,
  narrative,
  computed_at, locked_at
FROM buddy_sba_scores
WHERE deal_id = '<RUN_DEAL_ID>'
ORDER BY computed_at DESC;
```

**Evaluation:**
- Did a row get written?
- If yes: does score = sum of component contributions?
- Is `band` rate-card-eligible (one of the 4 the rate card supports)?
- Is `eligibility_passed = true`?
- Is `eligibility_failures` empty (or populated with real failure reasons)?
- Does the narrative reference Madison Bagel Co specifics or read as generic?
- If no row: what error appears in Vercel runtime logs at the time the trigger fired?

**Findings to file:**
- **This is the highest-value finding of the entire run.** Document the trigger condition explicitly. If the score worker errored, capture the error.
- Reproduce/refute audit P0 #1, P1 #14
- Document the score computation against the input data (does the score make sense for this borrower profile?)

**If no score row was produced:** **HALT** the run after documenting. Subsequent stages (feasibility, trident, validation, sealing) all gate on the score. Without it, those stages cannot execute. Document the halt; this is a P0 finding for Sprint 6C investigation.

### Stage 8 — Feasibility study

**Trigger:** Investigate. May be a separate worker, a banker-side action, or auto-generated.

**Capture:**
```sql
SELECT *
FROM buddy_feasibility_studies
WHERE deal_id = '<RUN_DEAL_ID>'
ORDER BY version_number DESC;
```

**Evaluation:**
- Did a study get generated?
- Is `is_franchise = false`?
- Are dimension scores populated?
- Composite score calculated correctly per the documented formula?
- Market analysis narrative specific to bagel shop / Madison, or generic?

### Stage 9 — Trident bundle generation (preview mode)

**Trigger:** Likely a banker-side action in the cockpit ("Generate Trident bundle"). Read source if unclear.

**Capture:**
```sql
SELECT
  id, mode, status,
  business_plan_pdf_path,
  projections_pdf_path,
  projections_xlsx_path,
  feasibility_pdf_path,
  redactor_version,
  generation_started_at,
  generation_completed_at,
  generation_error
FROM buddy_trident_bundles
WHERE deal_id = '<RUN_DEAL_ID>'
ORDER BY generation_started_at DESC;
```

**Evaluation:**
- Did a preview bundle get generated?
- All four paths populated (note the spec missed the XLSX path — P2 #39)?
- `redactor_version = '1.0.0'`?
- Did generation complete without error?

**Visual verification:** Download the PDFs from the storage bucket. For each:
- Watermark visible on every page
- No precise dollar amounts in business plan narrative
- Narrative placeholders read "[Unlocks when you pick a lender]"
- DSCR visible (preview signal)
- Page count reasonable

### Stage 10 — Validation report

**Trigger:** Investigate.

**Capture:**
```sql
SELECT *
FROM buddy_validation_reports
WHERE deal_id = '<RUN_DEAL_ID>'
ORDER BY run_at DESC;
```

**Evaluation:**
- Did validation fire?
- `overall_status` = 'passed', 'warning', or 'failed'?
- If 'failed': what failures are listed and are they legitimate (i.e., the deal really has issues) or false positives?

### Stage 11 — Sealing dry-run

Now run sealing through the actual UI (not the script-from-tmp path the audit used).

**Trigger:** As the borrower (use the cookie from Stage 1), navigate to `/start`, find the SealPackageCard for this deal, click "Seal my package", confirm.

**Capture before clicking Seal:**
```
# Use the actual seal-status route to verify gate state
# (curl or browser dev tools network tab)
GET <preview-url>/api/brokerage/deals/<RUN_DEAL_ID>/seal-status
# Expected: status.kind = "ready" with score and band
```

If status is `not_ready`, the gate is failing. Document the reasons returned and **HALT** sealing. This is a finding — the upstream stages produced output but the gate doesn't accept it.

**Capture after clicking Seal:**
```sql
SELECT
  sp.id AS sealed_id, sp.sealed_at,
  ml.id AS listing_id, ml.status, ml.score, ml.band,
  ml.rate_card_tier, ml.published_rate_bps,
  ml.sba_program, ml.loan_amount, ml.term_months,
  ml.kfs_redaction_version,
  array_length(ml.matched_lender_bank_ids, 1) AS matched_count,
  ml.preview_opens_at, ml.claim_opens_at, ml.claim_closes_at,
  jsonb_pretty(ml.kfs) AS kfs
FROM buddy_sealed_packages sp
JOIN marketplace_listings ml ON ml.sealed_package_id = sp.id
WHERE sp.deal_id = '<RUN_DEAL_ID>'
ORDER BY sp.sealed_at DESC LIMIT 1;
```

**Critical KFS PII leak grep:**
```sql
SELECT kfs::text FROM marketplace_listings
WHERE deal_id = '<RUN_DEAL_ID>'
ORDER BY created_at DESC LIMIT 1;
```

Pipe the output to a grep for: `Madison Bagel`, `Test Borrower`, `Madison`, `Wisconsin` zip codes if any were entered, the test borrower's name. Expect zero matches for legal/business names. State name `Wisconsin` is OK to appear (state-level disclosure is allowed). City name `Madison` should NOT appear in the redacted KFS.

**Evaluation:**
- Did sealing succeed?
- Does the listing's `term_months` match `loan_impact.termMonths` from Stage 4? (validates Sprint 5 round-5 corrections)
- Does the listing's `loan_amount` match `loan_impact.loanAmount`?
- KFS PII leak grep: zero matches for borrower-identifying tokens?
- `published_rate_bps`: matches the rate card row for this band/program/loan tier/term tier?
- `matched_lender_bank_ids` likely empty (no lenders provisioned pre-Sprint-4)
- `preview_opens_at`: next business day at 9am CT? (cadence verification)

**Findings to file:**
- Reproduce/refute audit P0 #11, P0 #12 (the buildSealedSnapshot fabrication and packageManifest hardcoded values — does Sprint 5's behavior change once real producers exist?)
- Any PII leak: **immediate P0 escalation**
- Any rate card miss: P0
- Any cadence calculation error: P1

### Stage 12 — Post-run snapshot + cleanup

```sql
SELECT
  'post_run_snapshot' AS marker,
  now() AS captured_at,
  (SELECT count(*) FROM deals) AS deals_count,
  (SELECT count(*) FROM borrower_concierge_sessions) AS sessions_count,
  (SELECT count(*) FROM borrower_applications) AS applications_count,
  (SELECT count(*) FROM borrower_applicants) AS applicants_count,
  (SELECT count(*) FROM borrower_applicant_financials) AS financials_count,
  (SELECT count(*) FROM buddy_sba_assumptions) AS assumptions_count,
  (SELECT count(*) FROM buddy_sba_packages) AS packages_count,
  (SELECT count(*) FROM buddy_sba_scores) AS scores_count,
  (SELECT count(*) FROM buddy_feasibility_studies) AS feasibility_count,
  (SELECT count(*) FROM buddy_trident_bundles) AS bundles_count,
  (SELECT count(*) FROM buddy_validation_reports) AS validations_count,
  (SELECT count(*) FROM buddy_sealed_packages) AS sealed_count,
  (SELECT count(*) FROM marketplace_listings) AS listings_count,
  (SELECT count(*) FROM deal_financial_facts) AS facts_count;
```

Compare with Stage 0 baseline. The deltas show exactly which tables got new rows during the run.

**Cleanup:**
- Leave the test deal in place for future reference. Do NOT delete.
- Document the deal's final state in the results file (deal_id, current stage, current sealing state).
- The deal becomes the canonical Golden Deal fixture replacing the hand-seeded "ChatGPT Fix N" pattern.

---

## Results file format

Single markdown file at `specs/brokerage/golden-deal-run-YYYY-MM-results.md` (per the naming convention table above):

```markdown
# Golden Deal Run — YYYY-MM Results

[Run Metadata block — copied from spec template, filled in]

## Pre-flight verification

- Fly gateway deploy: [confirmed at HH:MM]
- Sprint 5 PR #341 merged: [confirmed at HH:MM]
- SealPackageCard wired: [confirmed via grep]
- Preview URL: [URL]
- DB sanity check: [✓ all 5 tables empty / ✗ unexpected state]

## Executive summary

[3–5 sentences. What stages succeeded, what stages failed, what reproduced
from the audit, what new findings emerged. Severity counts updated against
audit baseline (P0 reduced/maintained/added counts).]

## Stage-by-stage execution log

### Stage 0 — Pre-run baseline
[the Stage 0 snapshot]

### Stage 1 — Borrower intake
**Trigger:** [exact action taken]
**Outcome:** [pass / partial / fail / halted]
**Captured state:** [SQL output]
**Findings:**
- [audit P0/P1/P2 reproduced / refuted / new finding]

[... repeat for Stages 2-12 ...]

## Audit P0 reproduction matrix

| Audit P0 # | Description | Reproduced? | Real-flow severity |
|----|----|----|----|
| #1 | scores globally empty | [yes/no/N-A] | [downgrade/maintain/upgrade] |
| #2 | concierge sessions empty | ... | ... |
| ... |

## New findings (not in original audit)

### [P0/P1/P2] [title]
**Stage discovered:** [n]
**Detail:** [what happened]
**Recommended fix:** [...]

## Updated punchlist after Golden Deal Run

### P0 (real, validated by run)
1. ...

### P1 (quality)
1. ...

### P2 (nice-to-have)
1. ...

## What the run validated

[Positive findings — things that worked correctly under real flow]

## What needs Sprint 6C

[The list of P0s that survive the Golden Deal Run and require focused fixes.]

## Open questions for Matt

[Any decision points the run surfaced that require strategic input.]

## The Golden Deal as fixture

**Deal ID:** [new deal_id]
**Final state:** [stage, sealing status]
**Use:** future audits should run against this deal as the canonical "real flow" reference, replacing the hand-seeded "ChatGPT Fix N" pattern.
```

If a run is halted partway and resumed, append a new "Resume N" section with its own metadata block, pre-flight re-verification, and stage-by-stage continuation. Do not edit prior-run sections — they are the historical record of what actually happened on that pass.

---

## Critical reminders for the operator

1. **Do not start the run until ALL FOUR pre-flight items pass.** **HALT** and flag if any fails.
2. **Investigate trigger conditions at the source.** Stages 3, 7, 8, 9, 10 all ask "what triggers this stage?" The audit doesn't know. Read the codebase to find out, then exercise the trigger. Document what you found.
3. **Capture state in real time.** Append to the results file after each stage. If you hit a 30-minute wait for a worker to fire, write up what you've seen so far while waiting.
4. **HALT rather than improvise on a missing-link finding.** If Stage 3 has no trigger (no `/start` → application path), document and stop. Do not write a new application creation API to keep the run moving. The missing link IS the finding.
5. **Do not modify Samaritus or any "ChatGPT Fix" deal.** Every write goes to the new test deal. If you need a fixture document for Stage 5 extraction, copy it; do not move it.
6. **Visual PDF eyeball is required at Stage 9.** Unit tests cannot verify watermarks. Download the PDFs and look at them. Save references in the results file to where you saved them locally so they can be retrieved.
7. **PII leak grep at Stage 11 is the most important single check.** If any borrower-identifying token leaks into the KFS, file as P0 immediately and **HALT**. The audit's redactor verification was theoretical (no real PII context); this is the first run with real PII context.
8. **Real-time logging.** When a stage takes more than 5 minutes (e.g., waiting for a worker), open Vercel runtime logs for that route to capture timing and any errors. Log captures go in the results file.
9. **The point is the trace, not the success.** A run that fails at Stage 4 with great documentation is more valuable than a run that limps to Stage 12 with vague findings. Quality of evidence matters more than completion.
10. **Stop-and-flag discipline.** When something doesn't match expectations, pause and check. Don't barrel through assumptions. The audit's value came from this discipline; the Golden Deal Run inherits it.

---

## Acceptance criteria

1. The results file `specs/brokerage/golden-deal-run-YYYY-MM-results.md` exists, fully populated, all 13 stages addressed (or halted with documented halt).
2. Each stage has a status (pass / partial / fail / halted).
3. Audit P0 reproduction matrix complete (all 13 P0s addressed).
4. New findings (those not in the audit) listed separately with severity.
5. Updated punchlist reflects post-run reality.
6. The new test deal exists and is documented as the canonical Golden Deal fixture.
7. No production code changes during the run.
8. No modifications to Samaritus or any prior "ChatGPT Fix" deal.
9. Results file is committed and visible on `main` (direct commit or fast-merge PR — operator's call per team norms at the time).

---

## What's NOT in this run (deliberate)

- **Fixes.** Fixes are Sprint 6C scope, scoped against this run's findings.
- **Multi-deal sampling.** One real run is enough to validate-or-refute the audit's predictions. Multi-deal coverage comes after Sprint 6C ships.
- **Performance benchmarks.** Correctness only.
- **Lender-side flow.** Sprint 4 doesn't exist yet at the time of the first run.
- **UI polish evaluation.** Different sprint.
- **Voice continuity / cross-session memory.** Different sprint.
- **Counsel review of rate card.** Independent track.

---

## Estimated timing

- Pre-flight verification: 5 min (assuming Matt completed his pre-work)
- Stage 0 baseline: 5 min
- Stages 1–2 (intake + chat completion): 30–60 min depending on extraction quality
- Stage 3 (application trigger investigation + execution): 30–90 min — this is the biggest unknown
- Stages 4–7 (assumptions, extraction, package, score): 30–60 min if workers fire automatically; multi-hour if investigation is needed
- Stages 8–10 (feasibility, trident, validation): 30–60 min
- Stage 11 (sealing): 15 min
- Stage 12 + writeup: 30 min

**Total: 3–4 hours nominal, possibly 6+ hours if multiple stages require trigger investigation.**

---

**Run is GO after the four pre-flight items pass. Single results file per run, no production code changes during the run, commit the results file when complete.**
