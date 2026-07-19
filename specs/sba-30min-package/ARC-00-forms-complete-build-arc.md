# ARC-00 — SBA Forms Complete: One Controlled Build Arc

**Date:** 2026-07-12 · **Owner:** Architecture (Matt) · **Executor:** Claude Code · **Effort:** 7–9 weeks sequential · **Risk:** Medium-high (regulatory contract surface; vendor integrations; prod-drift already observed)

**Goal:** At arc end, Buddy can complete — generate, fill the official PDF, collect IAL2-gated e-signature, store, and package — **every borrower-facing SBA form required for 7(a) and 504 lending**, verified in production, not just in the repo.

---

## Why this arc exists — verification findings (2026-07-12 audit)

Live audit of `main` + production Supabase found:

1. `build1919.ts` is a 5-field stub (real Form 1919 ≈ 80 fields). JSON only, no PDF.
2. `build1920.ts` builds a form **SBA eliminated in Dec 2023** (Notice 5000-852422). Dead code.
3. `sba_form_payloads`: **0 rows in prod** — cross-fill has never run.
4. `bank_document_templates`: **0 rows** — the fill engine has no official PDFs to fill. `public/sba-templates/` does not exist (S2 PIV-6 never done).
5. `sba_package_templates`: only `SBA_7A_BASE`. **No 504 package. No 1244 builder. Zero 504 forms capability.**
6. Form 159: workflow (records, fee ledger, blockers, ack) is wired, but `generated_payload` is inserted as `{}` and no PDF renderer exists. Every Buddy deal charges a fee — this is live compliance exposure.
7. 4506-C: stub that logs a pending record. No form generation, no IVES.
8. 912, 1244, 148/148L, 601, 722: no builders at all (912/1244 are upload-only checklist keys).
9. E-sign: `mockProvider.ts` only.
10. **S1 drift:** `20260428_seed_sba_rules_50108.sql` exists in the repo, but prod `sba_policy_rules` has **0 rows** and lacks `policy_version` / `superseded_at` columns. The migration was never applied. The eligibility engine is currently evaluating against nothing.

Specs S1–S5 in this folder correctly scope most of the work. This arc sequences them, corrects them where the audit found errors, and adds the two missing tracks (504, closing forms).

---

## Required-forms baseline (SOP 50 10 8, eff. 6/1/2025)

| Form | 7(a) | 504 | Trigger |
|---|---|---|---|
| SBA 1919 Borrower Information | ✅ | — | Every 7(a) deal |
| SBA 1244 + exhibits | — | ✅ | Every 504 deal |
| SBA 413 PFS | ✅ | ✅ | Each 20%+ owner & guarantor; 90-day staleness |
| SBA 912 Personal History | ✅ | ✅ | Conditional — criminal-history answers on 1919/1244 |
| IRS 4506-C | ✅ | ✅ | Every deal |
| SBA 159 Fee Disclosure | ✅ | ✅ | **Every Buddy deal** (fee-charging agent) |
| SBA 148 / 148L Guaranty | ✅ | ✅ | Closing — each guarantor (unlimited vs limited) |
| SBA 601 Agreement of Compliance | ✅ | ✅ | Closing — construction > $10K |
| SBA 722 EEO Poster | ✅ | ✅ | Closing — delivery item, not fillable |
| SBA 155 Standby Agreement | ✅ | ✅ | Seller note as equity |

Form 1920: **eliminated**. Lender data goes to E-Tran directly. Removed in Phase 0.

---

## Arc protocol — how CC executes this

**AP-1 — Sequential phases, hard gates.** No phase begins until the previous phase's gate block has been run against **production** and the output pasted into the phase's build log (`docs/build-logs/ARC00_PHASE_<n>_GATE.md`). Repo state is never sufficient — finding #10 is the proof.

**AP-2 — No scope drift.** Anything discovered mid-phase that isn't required to pass the current gate goes into the Drift Log at the bottom of this file (append, commit, move on). It does not get fixed inline.

**AP-3 — Schema-first.** Query `information_schema.columns` + `pg_constraint` before writing any insert/update code. Every prod table has had surprises.

**AP-4 — Migrations are atomic and hit prod immediately.** `DO $$` blocks / BEGIN-COMMIT. Verify application with a follow-up SELECT in the same session.

**AP-5 — Forms are contract surface (principle #14).** No invented defaults. Missing required fields flow to `deal_gap_queue` for borrower input via the Story tab + Borrower Voice path.

**AP-6 — Official templates are versioned artifacts (new principle #28).** Download from sba.gov at execution time; record revision date + sha256 in `bank_document_templates.metadata`; renderer refuses to fill when the stored revision no longer matches the SBA-published current revision list. Never commit a placeholder.

**AP-7 — 504 parity (new principle #29).** Every borrower-facing form capability ships for both programs or carries an explicit exclusion note in this file.

**AP-8 — Prod is the only truth (new principle #26).** A migration file in the repo is not "done." S1 taught this.

---

## Phase 0 — Ground truth, corrections, and the 159 fast win (≈ 0.5–1 wk)

### 0.A Apply S1 to production
The repo migration `20260428_seed_sba_rules_50108.sql` was never applied. Apply it (via `apply_migration`), then verify:
```sql
SELECT policy_version, count(*) total,
       count(*) FILTER (WHERE superseded_at IS NULL) live
FROM sba_policy_rules GROUP BY 1;
-- Expected: SOP_50_10_8 → 22 live
```
Also verify the eligibility engine filters `superseded_at IS NULL` (S1 scope). If prod schema diverges from the migration's assumptions, fix schema-first per AP-3.

### 0.B Delete Form 1920
- Remove `src/lib/sba/forms/build1920.ts`, its tests, and the `"1920"` branch + `SUPPORTED_FORMS` entry in `src/app/api/deals/[dealId]/sba/forms/[formId]/route.ts`.
- **Correction to SPEC-S4:** its "remaining forms" list includes 1920 — strike it. Do not build it in Phase 3.

### 0.C Official template ingestion pipeline
New script `scripts/ingest-sba-templates.ts`:
1. Download current official PDFs from sba.gov / irs.gov (verify revision date on the SBA forms page at execution time — do not hardcode revisions from this spec).
2. Parse AcroForm fields via the existing `templateParser`.
3. Commit PDFs to `public/sba-templates/` and upsert one global (bank-agnostic) row per form into `bank_document_templates` (`template_key` = `SBA_1919`, `SBA_413`, `SBA_912`, `SBA_1244`, `SBA_159`, `SBA_148`, `SBA_148L`, `SBA_601`, `SBA_155`, `IRS_4506C`) with `metadata` = `{revision, source_url, sha256, field_count, fill_strategy}`.
4. Any PDF without usable AcroFields → `fill_strategy: "overlay"` (pdf-lib coordinate drawing); document the coordinate map per form. Surface, don't guess.

### 0.D Form 159 — real payload + PDF renderer (fast win, highest compliance urgency)
The workflow already exists (`sba_form_159_records`, fee ledger, blockers, ack flow). Complete it:
- Build `src/lib/sba/forms/build159.ts` — full field payload from deal + fee ledger + lender pick (fees itemized, compensation description, agent = Buddy brokerage identity).
- Renderer fills the ingested official 159 template; write PDF to storage; populate `generated_pdf_path`; replace the `generated_payload: {}` insert in `complianceEnforcement.ts` with the real payload.
- Ack workflow now presents the actual PDF, not a preview stub.

### Gate 0 (run against prod, paste output)
```sql
SELECT (SELECT count(*) FROM sba_policy_rules WHERE superseded_at IS NULL)  AS live_rules,
       (SELECT count(*) FROM bank_document_templates WHERE is_active)       AS templates,
       (SELECT count(*) FROM sba_form_159_records WHERE generated_pdf_path IS NOT NULL) AS real_159s;
-- Gate: live_rules = 22 · templates ≥ 10 · real_159s ≥ 1 (smoke deal)
```
```sh
grep -rn "1920" src/lib/sba/forms/ src/app/api/deals --include="*.ts" | wc -l   # Gate: 0
```

---

## Phase 1 — SPEC S2 as written, with amendments (≈ 1.5–2 wk)

Execute `SPEC-S2-forms-and-plaid.md` (1919 full fidelity ~80 fields / 3 sections; 413 per signer with 90-day staleness + spouse signature; deal data builder; real Plaid). Amendments:

- **A-S2-1:** PIV-6 is superseded by Phase 0.C — templates come from `bank_document_templates`, not ad-hoc commits.
- **A-S2-2:** Cross-fill must actually run in prod. `sba_form_payloads` has 0 rows today; the gate requires a populated payload for the smoke deal.
- **A-S2-3:** 1919's criminal-history answers must persist as structured fields (they trigger 912 in Phase 3).

### Gate 1
```sql
SELECT form_name, count(*) FROM sba_form_payloads GROUP BY 1;
-- Gate: SBA_1919 ≥ 1 and SBA_413_* ≥ 1 for smoke deal
```
Plus: generated 1919 + 413 PDFs open with every mapped field filled; missing fields visible in `deal_gap_queue`; `wc -l` on `build1919.ts` reflects full-fidelity build (hundreds of lines, not 26).

---

## Phase 2 — SPEC S3 as written (IAL2 + DocuSeal) (≈ 1.5–2 wk)

No amendments. Persona IAL2 gate + self-hosted DocuSeal on Cloud Run, embedded via REST/iframe (no fork — AGPL untriggered). IAL2 FK enforced at request-time and webhook-time.

### Gate 2
- `mockProvider` no longer the default provider path (grep proof).
- Smoke deal: borrower completes IAL2, signs the Phase 1 Form 1919 through DocuSeal; envelope status round-trips to prod tables.
- Negative test: signature request without passing IAL2 is rejected at both enforcement points.

---

## Phase 3 — SPEC S4 amended (≈ 1.5–2 wk)

Execute S4 with these amendments:

- **A-S4-1:** Strike 1920 (eliminated form — Phase 0.B).
- **A-S4-2:** 159 already shipped in Phase 0.D — remaining 159 scope is only its e-sign hookup via DocuSeal.
- **A-S4-3:** 912 is a conditional **builder**, not an upload item: triggered by 1919 (and later 1244) criminal-history answers, prefilled from `ownership_entities`, e-signed, and the checklist key flips from upload-mode to generated-mode.
- **A-S4-4:** 4506-C: generate + prefill + e-sign at minute 1 (it's in the Phase 0 template set); IVES submission + polling stays background/async as spec'd. Form 155 when seller-note-as-equity per S1 rule triggers.
- Rest as written: soft-pull credit, CAIVRS, SAM.gov, equity-seasoning verifier.

### Gate 3
Smoke deal with a "yes" criminal-history answer produces a prefilled, signed 912; 4506-C signed; `SBA_7A_BASE` package run generates all items with `status='generated'` and non-null `output_storage_path`.

---

## Phase 4 — NEW SPEC S6: the 504 track (≈ 1–1.5 wk)

Nothing exists today. Build:

1. **Migration:** seed `sba_package_templates` with `SBA_504_BASE`; items: `SBA_1244` (required), `SBA_413` (required), `SBA_912` (conditional), `IRS_4506C` (required), `SBA_159` (required), `applies_when: {"product":"504"}`.
2. **`build1244.ts`** — full-fidelity 1244 + exhibits map: project costs and the 50/40/10 structure, occupancy percentage, job creation/retention or public-policy goals, debt-refi fields, plus the same certification sections as 1919. Reuse the S2 module pattern (fields → build → inputBuilder → render → routes → tests) and the deal-data builder.
3. Route support: add `"1244"` to `SUPPORTED_FORMS`; cross-fill writes `SBA_1244` payloads; 912 trigger reads 1244 answers too (A-S4-3 parity).
4. 504 context: `deal_loan_requests` columns for project cost split / CDC portion — verify schema first (AP-3), additive migration if missing.

### Gate 4
```sql
SELECT pt.code, count(pi.*) FROM sba_package_templates pt
JOIN sba_package_items pi ON pi.package_template_id = pt.id GROUP BY 1;
-- Gate: SBA_7A_BASE and SBA_504_BASE both present with full item sets
```
Smoke 504 deal: package run generates filled 1244 + 413 + 4506-C + 159 PDFs; signed via DocuSeal.

---

## Phase 5 — NEW SPEC S7: closing forms + package assembly (≈ 1 wk)

1. **148 / 148L builders** — one per guarantor; unlimited vs limited decision driven by `src/lib/ownership/rules.ts`; e-signed.
2. **601** — conditional builder (construction > $10K in use of proceeds).
3. **722** — not fillable: ships as a closing-stage delivery/acknowledgment checklist item with the official poster PDF attached.
4. **SBA 10-tab package assembly** (pulled forward from S5): walk all generated forms + documents into the 10-tab structure for both `SBA_7A_BASE` and `SBA_504_BASE`; output a single lender-ready package.

### Gate 5
Both smoke deals (7a + 504) produce a complete 10-tab package containing every applicable signed form; conditional forms (912, 601, 155, 148L) appear only when triggered.

---

## Phase 6 — SPEC S5 as written (third-party orchestration + real E-Tran)

No amendments beyond the package-assembly pull-forward (Phase 5.4). Human-approval gate on E-Tran is permanent (principle #25).

### Gate 6 / Arc-end verification (run against prod, paste into `docs/build-logs/ARC00_COMPLETE.md`)
```sql
SELECT
 (SELECT count(*) FROM bank_document_templates WHERE is_active)                    AS templates,
 (SELECT count(DISTINCT code) FROM sba_package_templates)                          AS packages,
 (SELECT count(*) FROM sba_policy_rules WHERE superseded_at IS NULL)               AS live_rules,
 (SELECT count(DISTINCT form_name) FROM sba_form_payloads)                         AS payload_forms,
 (SELECT count(*) FROM sba_form_159_records WHERE generated_pdf_path IS NOT NULL)  AS real_159s;
```
Acceptance matrix — every row must be ✅ generate / fill / sign / store on a prod smoke deal:

| Form | Generate | Fill PDF | E-sign (IAL2) | Stored | 7(a) | 504 |
|---|---|---|---|---|---|---|
| 1919 | | | | | ✅ | n/a |
| 1244 | | | | | n/a | ✅ |
| 413 | | | | | ✅ | ✅ |
| 912 (cond) | | | | | ✅ | ✅ |
| 4506-C | | | | | ✅ | ✅ |
| 159 | | | | | ✅ | ✅ |
| 148/148L | | | | | ✅ | ✅ |
| 601 (cond) | | | | | ✅ | ✅ |
| 155 (cond) | | | | | ✅ | ✅ |
| 722 (delivery) | | n/a | ack | | ✅ | ✅ |

---

## New build principles captured by this arc

**#26 — Prod is the only truth.** A spec or migration in the repo is not "done" until verified live. (S1 sat unapplied for 2.5 months while the engine evaluated against zero rules.)

**#27 — One arc, hard gates, no parallel drift.** Phases run in order; gates are prod-verified; discoveries go to the Drift Log.

**#28 — Official templates are versioned artifacts.** Revision + sha256 recorded; renderers refuse stale templates.

**#29 — 504 parity.** Every borrower-facing capability ships for both programs or carries an explicit exclusion note.

---

## Drift Log

*(CC appends here — date · phase · finding · disposition. Nothing gets fixed inline unless it blocks the current gate.)*

- **2026-07-12 · Phase 0 · `sba_policy_rules` live schema diverged from its own `CREATE TABLE` migration.** `category`, `borrower_friendly_explanation`, `fix_suggestions`, `updated_at` were missing and the `program` CHECK only allowed `('7A','504')` despite `eligibility.ts` and the S1 rule set requiring `'BOTH'`. No `(program, rule_key)` unique constraint existed despite being declared. Disposition: fixed inline (blocked Gate 0 — the S1 migration could not apply without it). See `docs/build-logs/ARC00_PHASE_0_GATE.md`.
- **2026-07-12 · Phase 0 · `bank_document_templates.bank_id` was `NOT NULL`, so a bank-agnostic global template row (required by Phase 0.C) had no way to exist.** Disposition: fixed inline (blocked Gate 0 — the ingestion pipeline can't write rows without it). Migration `20260712_bank_document_templates_allow_global`.
- **2026-07-12 · Phase 0 · outbound network access to sba.gov/irs.gov is blocked by this session's proxy policy (403 on both `curl` and `WebFetch`).** Disposition: not fixed — environmental, not code. `scripts/ingest-sba-templates.ts` was built as complete infrastructure per AP-6 (no placeholder committed) and is ready to run wherever network access exists. `bank_document_templates` remains at 0 rows in prod until then; Gate 0's `templates ≥ 10` and `real_159s ≥ 1` do not pass this session.
- **2026-07-12 · Phase 0 · `deal_sba_rule_evaluations` (referenced by `eligibility.ts`) does not exist in prod.** The insert is unchecked inside a `Promise.all`, so it silently no-ops today. Disposition: not fixed — doesn't block Gate 0, flagged for whichever phase next touches `eligibility.ts`.
- **2026-07-12 · Phase 0 · `ruleEngine.ts`'s `evaluateAllRules` filters `sba_policy_rules` on `program` using lowercase `"7a"`/`"504"`, but the stored value is uppercase `'7A'`.** This query never matches anything. Disposition: not fixed — separate bug, separate file, out of the S1 change set.
- **2026-07-12 · Phase 0 · `generatePdfBytesFromFillRun.ts` queries `bank_document_templates` by `code`/`storage_path` columns that don't exist (real columns: `template_key`/`file_path`).** Dead/broken code path. Disposition: not fixed — out of scope.
- **2026-07-12 · Phase 0 · `package-lock.json` was out of sync with `package.json` before this session** (`npm ci` failed on several transitive deps). Disposition: not fixed — `npm install` was used locally to unblock verification but the lockfile diff was not committed; someone should refresh and commit it as its own change.
- **2026-07-12 · Phase 0 · neither `generateForm159Preview` (compliancePackage.ts) nor `ensureForm159ForPickedLender` (complianceEnforcement.ts) is called from any live API route.** Both were already dead/test-only code before this session. Disposition: not fixed — their `generated_payload: {}` bug is fixed (Phase 0.D), but wiring either into a real request path is unscoped work for a later phase.
- **2026-07-12 · Phase 1 · `deal_loan_requests` was missing all 7 SPEC-S2 A-1 columns** (only `use_of_proceeds` pre-existed). Disposition: fixed inline (migration required for the deal data builder). See ARC00_PHASE_1_GATE.md.
- **2026-07-12 · Phase 1 · `financial_snapshots_v1` does not exist in prod** — only `financial_snapshots` (jsonb blob) and `financial_snapshots_v2` (validation tracking, no financial values). Disposition: `dealDataBuilder.ts` reads DSCR from `financial_snapshots.snapshot_json.dscr.value_num` instead, per the spec's own "adapt accordingly" instruction.
- **2026-07-12 · Phase 1 · `banks` has no `settings` column.** `lender_is_federally_regulated` (S1 rule `SCREENING.SBSS_NOT_USED_BY_FEDERAL_LENDERS`) has no data source. Disposition: not fixed — `dealDataBuilder.ts` returns `null`, correctly surfaced as a gap.
- **2026-07-12 · Phase 1 · Plaid's `/transactions/sync` cursor pattern had nowhere to persist its cursor** — the A-3 schema as specced omitted a cursor column. Disposition: fixed inline, additive migration `20260429_d_borrower_bank_connections_sync_cursor` (blocked `sync.ts` otherwise).
- **2026-07-12 · Phase 1 · no `PLAID_CLIENT_ID`/`PLAID_SECRET` configured in this environment.** V-2c (live Plaid sandbox Link round-trip) could not be executed. Disposition: not fixed — requires credentials only a human can provision; all Plaid module code short of the live OAuth round-trip is real and unit-tested.
- **2026-07-12 · Phase 1 · `sba_form_payloads` is keyed by `application_id → borrower_applications`, a parallel legacy subsystem (a *third* SBA-eligibility engine exists: `src/lib/sba7a/eligibility.ts`, alongside `src/lib/sba/eligibility.ts` and `src/lib/sba/eligibilityEngine.ts`) distinct from the deal-centric builder/form system SPEC-S2 actually specifies.** Disposition: not fixed — Gate 1's `sba_form_payloads` check (ARC-00 amendment A-S2-2) does not cleanly apply to what was built; writing into it would mean inventing a reconciliation between two independently-evolved subsystems without a spec for how they should relate. See ARC00_PHASE_1_GATE.md "Known gap."
- **2026-07-12 · Phase 1 · no fully-populated SBA smoke deal exists in prod** (the `d65cc19e-...` "Samaritus" deal referenced by S1/S2 specs' own verification sections does not exist in this database; the one real `deal_type='SBA'` row has no borrower/loan-request/ownership data). Disposition: not fixed — V-2b/d/e/f could not be end-to-end verified against real business data; queries were manually traced against real schema/rows instead (see gate log).
- **2026-07-12 · Phase 2 · SPEC-S3's `idx_sd_expiring` index SQL is invalid** — `WHERE expires_at > NOW()` fails at apply time because `NOW()` is not IMMUTABLE and Postgres partial-index predicates must be. Disposition: fixed inline (blocked the `signed_documents` migration). Indexed the plain column instead; "within N days" filtering moved to query time in `staleSignatureChecker.ts`.
- **2026-07-12 · Phase 2 · no Persona account provisioned** (`PERSONA_API_KEY`/`PERSONA_WEBHOOK_SECRET`/`PERSONA_TEMPLATE_ID_IAL2` all unset). Disposition: not fixed — requires a human to provision the vendor account (spec addendum: "block until Matt provisions"). All client/service code is real and unit-tested against mocks.
- **2026-07-12 · Phase 2 · no GCP/Cloud Run access in this environment** (no `gcloud` CLI, no credentials). Disposition: not fixed — DocuSeal deployment is explicitly out of executor scope per the spec addendum without GCP credentials. `infrastructure/docuseal/` (Dockerfile, cloudrun.yaml, README with AGPL position + deployment runbook) committed for ops handoff.
- **2026-07-12 · Phase 2 · DocuSeal webhook signature format (`X-Docuseal-Signature` header, HMAC-SHA256 of raw body) is a documented assumption, not verified against a live instance.** Disposition: not fixed — no DocuSeal deployment exists to test against. Flagged explicitly in `infrastructure/docuseal/README.md` for whoever deploys it to confirm/adjust `verifyDocusealWebhook.ts` against the real instance's webhook settings.
- **2026-07-12 · Phase 1+2 · route/page slot budget warning breached** (`routeConsolidationGuard.test.ts`: 1908 vs. 1900 warning threshold; Vercel's undocumented hard cap is 2048). 15 new individual `route.ts` files added across Phases 1–2. Disposition: **not fixed — flagged as an escalating risk for Phases 3–6**, each of which will plausibly add a comparable number of routes and could reach the hard cap within 2–3 more phases. Recommend consolidating into the existing catch-all/action-dispatch pattern (`model-v2/[action]`, `workers/[...path]`) before/during Phase 3, and building all subsequent phases' routes with that pattern from the start. See ARC00_PHASE_2_GATE.md.
- **2026-07-12 · Phase 3 · PIV-3/PIV-4 vendor-pick and legal-review confirmation round-trips were not gated on Matt.** Per this session's explicit "continue with build until all phases are completed" instruction, defaults were chosen and documented instead of blocking: credit bureau=`plaid_check`, CAIVRS=SBA-authorized direct, IRS transcripts=`ncs` (spec addendum's own stated preference over IRS direct). FCRA/CAIVRS consent text shipped as DRAFT-watermarked `public/consent-templates/*.md`, not legally reviewed. Disposition: not fixed — needs a human confirmation pass before any of this touches a real borrower. All vendor clients are swap-in-configurable, not hardcoded to these picks.
- **2026-07-12 · Phase 3 · `banks` has no `settings` column (confirmed again — same finding as Phase 1's `lender_is_federally_regulated` note).** SPEC-S4's `banks.settings.caivrs_credentials` and Form 4506-C's "third-party recipient = lender bank info from banks.settings.irs_third_party" don't apply. Disposition: not fixed — CAIVRS credentials read from env vars (same pattern as every other vendor in this arc); 4506-C's recipient address/phone stay `null`, a real gap not a fabrication.
- **2026-07-12 · Phase 3 · Form 155's standby creditor (the seller) has no identity/address representation anywhere in canonical state** — `deal_loan_requests` only carries `seller_note_equity_portion`/`seller_note_full_standby`, no seller name/address/entity row. E-signature can't be requested for that party through the existing `signer_ownership_entity_id` FK. Disposition: not fixed — `form155/build.ts`'s `standby_creditor_signable: false` documents this permanently; the borrower-side signer works today. Needs a schema addition (a seller/counterparty table, or extending `ownership_entities` to model non-owner signers) before Form 155 can be fully e-signed both sides.
- **2026-07-12 · Phase 3 · a second, independent SBA package-generation system already existed** (`src/lib/sba/package/{resolvePackage,buildPackage}.ts` + `sba_package_templates/_items/_runs/_run_items` + `fill_runs`), separate from every form module ARC-00 Phases 0–2 built. Its renderer (`generatePdfBytesFromFillRun.ts`) was already flagged dead/broken in the Phase 0 Drift Log (queries `bank_document_templates` by nonexistent columns) and its `fillEngine` only knows 5 hardcoded generic fields — no mapping for 1919/413/912/155/159/4506-C at all. Disposition: **fixed inline, scoped narrowly** — new `src/lib/sba/package/sbaFormDispatch.ts` intercepts the 6 ARC-00 form codes in `generatePdfForFillRun.ts` (the actual adapter the live package-generate route calls) and routes them to their real `buildWithSignature`+`render` functions; every other `template_code` still falls through to the untouched legacy path. This was judged "blocks the current gate" (Gate 3 literally requires `sba_package_run_items.status='generated'` with real output) rather than a deferred finding — same category as Phase 0's `bank_document_templates.bank_id` fix.
- **2026-07-12 · Phase 3 · `sba_package_run_items` models exactly one output PDF per `template_code` per package run, but Forms 413/912/4506-C are legitimately one-PDF-per-signer.** Disposition: not fixed — `sbaFormDispatch.ts` renders the first applicable signer only per run item; the output is genuinely complete for that signer, not a placeholder. A real fix needs either a signer dimension on `sba_package_run_items` or a one-row-per-signer run-item model — scoped as follow-up schema work, not attempted this phase.
- **2026-07-12 · Phase 3 · no fully-populated SBA smoke deal exists in prod (same finding as Phase 1, still open).** Gate 3's literal "smoke deal with a 'yes' criminal-history answer" verification could not be executed live. Disposition: not fixed — every code path it depends on is unit/integration-tested against mocked data instead; see ARC00_PHASE_3_GATE.md.
- **2026-07-12 · Phase 3 · route/page slot budget warning threshold now formally breached** (`routeConsolidationGuard.test.ts`'s "stays below 1900 warning threshold" subtest now fails: 1930-1955 slots depending on measurement method, vs. 1900). Phase 3 added 15 new `route.ts` files (credit-pull/caivrs/sam: 3, irs-transcripts: 2, form4506c/912/155: 6) — the Phase 2 gate's prediction ("could reach the hard cap within 2-3 more phases") is on schedule. The 2048 hard-cap test still passes with ~93-118 slots of headroom. Disposition: **not fixed — same escalating-risk disposition as Phase 2, now more urgent.** Phases 4-6 (504 track, closing forms + package assembly, E-Tran) will each plausibly add a comparable number of routes; at this rate the hard cap is reachable within 1-2 more phases, not 2-3. Whoever picks up Phase 4 should treat route consolidation as a blocking pre-step, not a nice-to-have.
- **2026-07-12 · Phase 4 · acted on Phase 3's own route-consolidation recommendation.** Form 1244's routes shipped as a single consolidated `/sba/forms/1244/[action]/route.ts` (action ∈ {build, render}) instead of the two-file convention every earlier phase used — same URL shape, half the slot cost (2 slots vs 4). Disposition: adopted going forward — Phase 5's closing forms (148/148L/601/722) should use the same pattern. Route budget after Phase 4: 1957/2048, 91 slots to the error threshold.
- **2026-07-12 · Phase 4 · `SBA_504_BASE`'s `SBA_159` item is seeded `required:true`, inconsistent with `SBA_7A_BASE`'s `SBA_159` (`required:false`, conditional on `agent_used`).** Followed the Phase 4 spec section's literal item list as written rather than reconciling the inconsistency unprompted. Disposition: not fixed — the `required` column is informational only (nothing in `resolvePackage.ts`/`sbaFormDispatch.ts` enforces it; the dispatcher's own `agent_used` gate still applies regardless), so this has no functional effect, but whoever owns package-item semantics should decide which convention is correct and reconcile it.
- **2026-07-12 · Phase 5 · `src/lib/ownership/rules.ts` had no unlimited-vs-limited guarantee decision logic despite the Phase 5 spec section assuming it did** ("unlimited vs limited decision driven by src/lib/ownership/rules.ts"). Disposition: fixed inline (blocked Form 148/148L from having anywhere correct to live the business rule) — added `determineGuaranteeType()` to that file. No codified threshold exists anywhere for when a *minority* owner below 20% is also required to guarantee (a lender-credit-policy call, not a codified SBA rule) — implemented as "any nonzero stake below 20% gets a limited guarantee," which a bank's own policy can override; flagged as an assumption, not verified against any real bank's credit policy.
- **2026-07-12 · Phase 5 · the SBA "10-tab package" structure has no authoritative source anywhere in this codebase or the arc's spec docs.** `tenTabAssembly.ts`'s 10-tab breakdown (loan application → PFS → personal history → tax verification → fee disclosure → standby agreements → guarantees → compliance → closing acks → supporting docs) is a standard SBA-lender submission convention, not a value read from a real spec. Disposition: not fixed — flagged for whoever owns the actual lender relationship to confirm the real expected tab order before an actual submission relies on it.
- **2026-07-12 · Phase 5 · generated package items can live in either of two storage buckets** (`bank-forms` — this arc's own upload path from Phase 3 onward — or `deal-documents` — Form 159's separate, pre-existing upload path from Phase 0, unchanged by this arc) **with no bucket recorded per item in `sba_package_run_items`.** Disposition: worked around, not fixed at the schema level — `assembleTenTabPackage.ts` tries both buckets in sequence rather than adding a bucket column; a real fix would normalize all SBA form uploads to one bucket or track bucket per item.
- **2026-07-12 · Phase 5 · Story tab UI (`SbaSigningPanel.tsx`/`signing-status/route.ts`) wasn't extended for the 4 new closing forms** (148/148L/601/722) — still only covers the Phase 3 forms. Disposition: not fixed — the Phase 5 spec section didn't call for UI work, only form modules + assembly, so this wasn't attempted proactively; flagged as a natural follow-up.
- **2026-07-12 · Phase 6B · a pre-existing, differently-shaped legacy `public.etran_submissions` table (0 rows: `id, application_id, xml, submitted_at, status, reference_id, error, created_at, updated_at`) silently no-op'd `CREATE TABLE IF NOT EXISTS public.etran_submissions` in migration `20260605_c_etran_credentials.sql`, then `CREATE INDEX ...(deal_id)` failed because the legacy table has no `deal_id` column.** Confirmed via `information_schema` that the whole migration transaction rolled back atomically (verified `bank_etran_credentials` was also absent afterward — no partial apply). Disposition: fixed inline (blocked the migration) — renamed the new table to `sba_etran_submissions`, matching the `sba_`-prefix convention `sba_package_runs`/`sba_package_items` already use. The legacy table itself is untouched, non-destructive.
- **2026-07-12 · Phase 6B · pgcrypto's functions (`pgp_sym_encrypt`/`pgp_sym_decrypt`) live in the `extensions` schema on this Supabase project, not `public`.** Migration `20260605_d_etran_rpc.sql`'s `SECURITY DEFINER` RPCs failed with `function pgp_sym_decrypt(bytea, text) does not exist` under `SET search_path = public` alone — confirmed the actual location via `pg_proc`/`pg_namespace` before fixing. Disposition: fixed inline (blocked the migration) — both RPCs' `search_path` now reads `public, extensions`. Live round-trip smoke test performed post-fix (encrypt → store → decrypt exact match; confirmed the `bytea` column contains no plaintext), test row cleaned up afterward. Flagging for any future Supabase-project migration that calls pgcrypto directly — this is standard Supabase convention, not specific to this table.
- **2026-07-12 · Phase 6B · `deal_truth_snapshots` has only 3 columns in prod** (`id`, `deal_id`, `created_at`) **but `generateETranXML` (this phase's own dependency, plus `policyEngine.ts`, flagEngine, autopilot, and the arbitration routes) all read/write a `truth`/`truth_json`/`version` shape that doesn't exist there.** This means `generateETranXML` can never actually reach `ready_for_review: true` against real prod data today — `submitToSba`'s step 1 will always return `VALIDATION_FAILED` in production until this is addressed. Disposition: **not fixed — judged not to block this gate.** `submitToSba`/the new `submit-etran` action integrate exactly per spec and fail closed gracefully on this gap, consistent with every other "real code, missing upstream data" pattern in this arc (Persona/DocuSeal/CAIVRS-style). Populating `deal_truth_snapshots` for real is a separate, materially larger effort (an entire truth-snapshot-writer subsystem) spanning multiple pre-existing callers — out of scope for a single-phase inline fix per AP-2.
- **2026-07-18 · Post-arc fix · root-caused and fixed the schema half of the above finding; the writer-subsystem half is still open.** Traced the "3 columns in prod" mystery to its actual cause: an untracked migration (`20260519201643_create_deal_truth_snapshots_stub`, recorded in `supabase_migrations.schema_migrations` but never committed to this repo) had recreated `deal_truth_snapshots` down to `(id, deal_id, created_at)` — silently regressing it from the full table `20251227000002_agent_arbitration.sql` defines and every real consumer already codes against. Confirmed via `information_schema`/`pg_constraint`/`pg_indexes` before touching anything. Fixed via a new, checked-in migration (`20260718000008_restore_deal_truth_snapshots_schema.sql`) restoring `bank_id`/`truth_json`/`version`/`total_claims`/`resolved_claims`/`needs_human`/`overall_confidence`/`bank_overlay_id`/`bank_overlay_version`/`created_by`, the `deal_id`/`bank_id` FKs, and all 4 original indexes (table had 0 rows in every environment checked, so no backfill was needed). Separately, `etran/generator.ts`'s own `generateETranXML` had an independent bug on top of the schema drift — it queried `.select("truth")` and read `row.truth`, but the real column has always been `truth_json` (confirmed: every OTHER consumer — `policyEngine.ts`, `flagEngine`, `credit-memo/export`, `autopilot/status`, the arbitration routes — already correctly used `truth_json`/`version`; this was the one outlier). Fixed the query + added an injectable `sb` param (matching `submitter.ts`'s existing DI pattern) so a regression test could actually exercise the DB-touching function, which the file's own tests had never done before. **Still open, unchanged from the original finding**: the one real writer of this table (`POST /arbitration/materialize`, which compiles `arbitration_decisions` into a `truth_json` snapshot) cannot run at all — `arbitration_decisions` and `bank_overlays` don't exist in this database either (confirmed via `to_regclass`), so the "entire truth-snapshot-writer subsystem" the original finding scoped out is still exactly as absent as before. Restoring the schema means `generateETranXML` now fails closed correctly (schema-compatible, "no truth snapshot found") instead of throwing on a missing column — a real robustness fix — but it does **not** mean E-Tran generation produces real data end-to-end yet, since nothing populates a real snapshot for any deal today.
- **2026-07-18 · Post-arc fix, part 2 · the writer subsystem itself was also restorable, and is now restored.** Followed the same `information_schema`/`pg_constraint`/`to_regclass` investigation one level deeper: `agent_claims`, `claim_conflict_sets`, and `arbitration_decisions` (all three from `20251227000002_agent_arbitration.sql`, not just `deal_truth_snapshots`) plus `bank_overlays`/`overlay_application_log`/`overlay_generated_claims` (all three from the separately-tracked `20251227000003_bank_overlays.sql`) and both helper functions (`generate_claim_hash`, `update_conflict_sets_updated_at`) were **also** entirely absent from the live database, despite both migrations being recorded as applied in `supabase_migrations.schema_migrations`. The migration history shows an RLS-hardening pass (`snapshot_rls_service_role_policies`, `rls_service_role_zero_policy_tables`) immediately preceding the untracked `deal_truth_snapshots` stub migration — the most likely explanation is a broader, undocumented cleanup dropped this whole subsystem at once, not just the one table. The application code was never touched: `POST /arbitration/ingest` (writes `agent_claims`/`claim_conflict_sets` from `agent_findings`), `POST /arbitration/reconcile` (applies rules R0-R5 + optional bank overlay, writes `arbitration_decisions`), `POST /arbitration/materialize` (writes `deal_truth_snapshots`), and `GET /arbitration/status` are all real, complete, correctly-written code — they had simply had their tables pulled out from under them. Fixed via a new migration (`20260718000009_restore_agent_arbitration_and_bank_overlays.sql`) recreating all 6 tables + both functions verbatim from the two original migration files (all confirmed 0 rows, pure additive restoration). Verified live: ran a full smoke test through the real schema (claim → conflict set → decision → truth snapshot, using `generate_claim_hash()` and confirming the `updated_at` trigger fires on `UPDATE`) against an existing deal, confirmed `generateETranXML`'s exact query shape resolves the real `truth_json`, then deleted every test row (0 rows remain in all 4 tables afterward — no residue on the real deal). Also fixed a **separate, pre-existing bug** this restoration made reachable for the first time: `src/lib/autopilot/punchlist.ts`'s "open conflicts"/"eligibility failures" sections referenced columns that never existed on this schema (`claim_conflict_sets.claim_ids`/`.field_path` instead of the real `num_claims`/`predicate`; `arbitration_decisions.topic`/`.chosen_value` instead of the real join-through-`claim_conflict_sets`-by-`claim_hash`/`.chosen_value_json`) — with 0 rows in these tables that code path was unreachable and silently wrong; now that real rows can exist, it would have thrown on first real conflict/decision data. Fixed inline. Disposition: **the writer subsystem is now schema-complete and verified against real inserts.** What's still genuinely unverified: the actual arbitration *logic* (`normalizeAgentFindings`/`groupClaimsIntoConflicts`/`reconcileAllConflicts`/`applyBankOverlay` in `src/lib/agents/`) has zero unit test coverage and was not deep-tested here — this fix restored and verified the schema those functions write into, not the correctness of the rules R0-R5 themselves. Also unverified: whether anything currently calls `POST /arbitration/ingest` for a real deal today (i.e., whether `agent_findings` rows exist anywhere in this environment to seed the pipeline) — that's a question about upstream agent-finding generation, outside this fix's scope.
- **2026-07-19 · Post-arc fix, part 3 · found and fixed the actual caller: the S1-S9 "Make E-Tran Ready" autopilot pipeline (`src/lib/autopilot/orchestrator.ts`) was itself completely non-functional, for reasons independent of the schema drift above.** Traced this while wiring the pipeline into a real, reachable UI trigger (previously: `POST /api/deals/[dealId]/autopilot/run` was a decoy that wrote 4 hardcoded `ai_events` rows and claimed `etran_ready: true` without doing any work, and its 3 potential UI callers — `AutopilotConsole.tsx`, `DealActionsPanel.tsx`, `DealGodModePanel.tsx` — were all confirmed orphaned, imported by zero pages). Two independent, compounding problems found:
  1. **`deal_pipeline_runs`** (the pipeline's own run-tracking table, `20251227000005_deal_pipeline_runs.sql`) was **also** missing live — same untracked-migration pattern as parts 1-2, confirmed via `to_regclass`. Restored via `20260719000000_restore_deal_pipeline_runs.sql` (table + `pipeline_stage`/`pipeline_status` enums + `get_latest_pipeline_run`/`append_stage_log` helper functions), using the deny-all+service-role RLS pattern (not the original's `current_setting('app.current_bank_id')` policy — that GUC is never set anywhere in this codebase, making the policy either always-false or reliant on nonexistent infrastructure; plausibly why the table got dropped in the first place). Deliberately did NOT restore the separate, much larger, also-apparently-missing `20251227000007_dual_policy_mode.sql` scope (`deals.loan_product`/`primary_policy_pack`/`secondary_policy_pack`, a `policy_pack_configurations` table) — confirmed via grep that nothing in the autopilot pipeline code reads/writes those columns; flagged as a separate, adjacent gap, not fixed.
  2. **Even with the table restored, the pipeline could never complete past S2.** `executeStage2_Agents`/`S3_CLAIMS`/`S5_ARBITRATION`/`S6_TRUTH` each called their own sibling API route via a bare server-to-server `fetch(process.env.NEXT_PUBLIC_APP_URL + ...)` — a genuinely new outbound HTTP request carrying none of the original caller's Clerk session cookies. Every one of those target routes resolves its bank via `getCurrentBankId()`, which throws `not_authenticated` with no valid session — so `res.ok` would be `false` and the calling stage would throw, on every single real invocation, regardless of the schema fix. This was never previously observable because nothing had ever actually invoked `startAutopilotRun()` (confirmed dead code — exported, zero callers) to exercise it. Fixed by extracting each route's core logic into a plain, DI-able, importable function — `src/lib/arbitration/{ingestClaims,reconcileConflicts,materializeTruthSnapshot}.ts` — that the routes now delegate to (external behavior unchanged) and that `orchestrator.ts`'s stages call **in-process** instead of self-fetching. S2 was fixed the same way, reusing the already-importable `orchestrator` singleton from `src/lib/agents` directly instead of fetching `/agents/execute`.
  3. **Along the way, fixed dishonesty in the pipeline's own audit trail**, discovered while doing the extraction: S4_OVERLAYS and S7/S8 (conditions/narrative) always logged `"succeeded"` despite doing nothing (S4's own comment admits overlays are applied elsewhere; S7/S8 are explicit `// TODO` no-ops) — changed to the `StageLog` type's own already-defined-but-previously-unused `"skipped"` status. S5_ARBITRATION never actually passed `apply_bank_overlay: true` to the reconcile call despite S4's comment claiming overlays apply there — fixed (now the only place overlays can actually apply). S6_TRUTH's "Truth snapshot v${version} created" message would print even when materialization found zero decisions and created nothing (`data.data?.version` on a `truth_snapshot_created: false` response is `undefined`) — fixed to log an honest "skipped" in that case.
  4. **Serverless durability**: `startAutopilotRun()`'s fire-and-forget (`executeAutopilotPipeline(...).catch(...)`, never awaited) had no guarantee of surviving past the HTTP response on Vercel — wrapped in Next 15+'s `after()` (available and type-checks cleanly against this repo's Next 16.1.1; first use of this API in the codebase).
  5. **Real UI wiring**: rather than reusing the three orphaned, near-duplicate legacy panels (which also bundle two unrelated, unverified buttons — `borrower-connect`, `preapproval/run`), built a small, self-contained `AutopilotPanel.tsx` (trigger + live polling of the real `GET /autopilot/status`, showing per-stage progress/messages) and mounted it on `DealCockpitClient.tsx` — the one page every deal already reaches — next to the existing self-contained panel pattern (`BrokerageStagePanel`, `InsightPanel`).
  6. **Verification performed, and its real limits, disclosed plainly**: schema-level correctness for `deal_pipeline_runs` was proven the same way as parts 1-2 (live insert/select via the Supabase MCP tool). The 3 newly-extracted functions got real unit tests (`src/lib/arbitration/__tests__/pipelineStages.test.ts`) against fake, DI'd Supabase clients — including one genuine happy-path test (a real `AgentFinding` normalizes into real claims and conflict sets). **A full HTTP-level, end-to-end integration test (real POST to `/autopilot/run` → poll `/autopilot/status` → confirm a package bundle) was not possible in this environment**: Clerk has no keys configured at all here (`isClerkConfigured()` false), so every auth-gated route fails at `getCurrentBankId()` before reaching any business logic — confirmed by actually starting the dev server and hitting the route directly, not assumed. This is a genuine environmental limitation, not a shortcut taken; it was not routed around (no fake sessions, no auth bypass code added). One additional known gap surfaced but deliberately not fixed here: S1_INTAKE's `evaluateDocumentSubstitutions()` (Plaid/QBO/IRS-transcript connected-account document substitution) depends on 3 more tables — `document_substitutions`, `connected_account_data`, `borrower_account_connections` — that are **also** missing live. Confirmed this degrades gracefully today only because the calling code never checks the Supabase query's `error` field, so a missing-table error is silently treated the same as "no active connections" — a real, separate feature gap (connected-account document substitution simply never functions), left undisturbed since it's adjacent, not part of the pipeline this fix targeted, and would need its own due-diligence pass.
  7. Of the 9 agents the pipeline invokes (S2), only 4 (`sba_policy`, `eligibility`, `cash_flow`, `risk`) have real implementations; `credit`, `collateral`, `management`, `narrative`, `evidence` have none — this was already true before today's fix and is unchanged; S2 now at least reports this honestly in its stage log (`"4/9 agents completed (failed: credit, collateral, management, narrative, evidence)"`) instead of a blanket `"succeeded"`. Building the missing 5 agents is a separate, large, domain-modeling effort per agent, out of scope here.
  Full suite (11796 tests) green, typecheck/lint clean, no regressions in the 8 files touched.
- **2026-07-12 · Phase 6B · discovered a third independent, parallel legacy E-Tran subsystem**: `src/app/api/deals/[dealId]/etran/submit/route.ts` (pre-existing, dated before this session) uses `sba_form_payloads`/`sba_preflight_results`/the legacy `etran_submissions` table/`assertDealAccess`/`buildEtranXml` (`@/lib/etran/xml.ts`) — completely disconnected from this arc's deal-centric `generateETranXML`/`submitToSba`. Its PATCH "approve" handler has a `// TODO: Actually send XML to SBA E-Tran endpoint here` and has never been functional. Disposition: not fixed/reconciled — same disposition as every other parallel-legacy-subsystem finding this arc (Phase 1's `sba_form_payloads`/triple eligibility engines, Phase 3's generic `fillEngine`). The new real submission capability was added as a `"submit-etran"` action on the existing `/api/deals/[dealId]/sba` action-dispatch route instead of touching or replacing this file, avoiding both a path collision and a risky reconciliation with unclear ownership.
- **2026-07-12 · Phase 6B · no real SBA E-Tran sandbox account/mutual-TLS certificate exists in this environment** (`SBA_ETRAN_SANDBOX_ENDPOINT`/`SBA_ETRAN_PROD_ENDPOINT` and all `bank_etran_credentials` rows are unset/empty in prod). Disposition: not fixed — same category as Persona/DocuSeal/CAIVRS: requires a human to provision vendor access. `submitToSba` fails closed with `ETRAN_CREDENTIALS_MISSING` (503) until a bank admin configures real credentials via the new admin panel; `etranHttpClient.ts`'s mutual-TLS POST logic is real, complete, and unit-testable only up to the injected `postToSba` boundary — the actual handshake against SBA's real endpoint has not been exercised live.
- **2026-07-12 · Phase 6B · the E-Tran credential admin panel (`EtranCredentialAdminPanel.tsx`) was mounted as a second section on the existing `/banks/[bankId]/templates` page rather than given its own page route.** Route/page slot budget was already in "warning" status (1969/2048, only 30 headroom to the 1999 error threshold) before this phase's additions; `/banks/[bankId]/templates` is the only bank-scoped admin page that currently exists. Disposition: pragmatic reuse, not a new page — a dedicated `/banks/[bankId]/settings` page consolidating bank-level admin panels (templates, E-Tran, and any future vendor credential UI) is a reasonable follow-up but out of scope for this gate (AP-2).
- **2026-07-12 · Phase 6B · route/page slot budget update.** After Section A (third-party orchestration: 2 new route files) and Section B (1 new route file: `etran/credentials`), total is 1969/2048 (Vercel hard cap), 30 slots below the 1999 error threshold, still in "warning" status per `scripts/count-routes.mjs`. Phase 6C will add ~4 more route files (Vercel Cron jobs), bringing the total to roughly 1977 — still under the error threshold but with shrinking headroom. Disposition: not fixed — same escalating-risk disposition as Phases 2-4; route consolidation patterns (single `[action]/route.ts` per feature, extending existing action-dispatch routes) were followed throughout Phase 6, which kept growth to 3 new route files across two full spec sections instead of the 15+ seen in earlier phases.
- **2026-07-13 · Post-arc CI fix · `routeConsolidationGuard.test.ts`'s hardcoded "stays below 1900 warning threshold" subtest — flagged throughout this Drift Log as an escalating, accepted risk since Phase 3 — finally broke CI on PR #689** (this whole arc's PR): `apiRoutes*2 + pages*2` (this test's own formula, no overhead buffer) reached 1946 against main's 1878, entirely from this arc's cumulative route additions. Every prior gate doc characterized this as "known pre-existing failure, not a regression from this session's own incremental work" — true phase-by-phase, but false relative to the actual merge target (main), which is what the user asked to make green. Disposition: **fixed for real, not just documented** — a large consolidation pass merged 26 single-purpose `route.ts` files down to a handful of dynamic-segment dispatchers: all 8 fillable-form `[action]` routes (1244/148/155/1919/413/4506c/601/912) plus Form 722 into one `sba/forms/[formId]/[action]/route.ts`; the 3 screening checks (caivrs/credit-pull/sam) into `screening/[check]/route.ts`; `irs-transcripts` submit+status, `esign` request+status, and `kyc` initiate+status each into one GET+POST file; `borrower/plaid` exchange+link-token into `[action]/route.ts`; the 3 vendor webhooks (DocuSeal/Persona/Plaid) into `webhooks/[vendor]/route.ts`; and `banks/[bankId]` etran-credentials+third-party-vendors into `[resource]/route.ts`. `sba/eligibility` (zero UI callers, functionally redundant with `sba/route.ts`'s existing `evaluate-eligibility` POST action) was deleted outright as genuine dead code, not consolidated. `sba/signing-status` was folded into `sba/route.ts`'s existing `?view=` GET dispatcher as a new view rather than its own file. Every consolidation with a live UI caller (`SbaSigningPanel.tsx`, `EtranCredentialAdminPanel.tsx`) had that caller updated in the same change; every consolidation of a route with zero found callers (confirmed via repo-wide grep before touching each one) needed no caller update. Final count: 1898/2048 (test's formula), comfortably under 1900. Full regression suite re-run clean after the change (see gate log). This is the single largest mechanical diff in the arc's post-close history — flagged here rather than silently folded into an earlier phase's entry because it touches routes across every phase 2-6 built, not just one.
