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
