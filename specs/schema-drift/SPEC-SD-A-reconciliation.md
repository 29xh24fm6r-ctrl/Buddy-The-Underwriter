# SPEC SD-A — One-Shot Schema Drift Reconciliation

**Date:** 2026-04-27 · **Owner:** Architecture (Matt) · **Executor:** Claude Code · **Effort:** 3–5 days (depends on drift report scale; smaller if drift is concentrated, larger if widespread) · **Risk:** Medium-high (modifies production schema; reconciliation must not break existing application code)

**Depends on:** SD-C (CI drift detection — needed for the reconciliation input)

**Blocks:** Phase 2 of SD-C (flipping drift gate to blocking), SBA 30-min pack S1 production migration, every future migration that builds on objects assumed to exist by migration history

---

## Background

SD-C (CI Schema Drift Detection) ships a tool that produces `.drift_report/all-findings.json` listing every database object expected by migration history but missing from the live schema. As of 2026-04-27, manual investigation already confirmed a number of these:

- `sba_policy_rules` missing 4–5 columns (`category`, `borrower_friendly_explanation`, `fix_suggestions`, `effective_date`, `updated_at`)
- `committee_personas` table missing entirely
- `deal_sba_difficulty_scores` table missing entirely
- `ai_event_citations` table missing entirely
- `ai_events.model` column missing
- `bank_policy_chunks.embedding`/`source_label` columns missing
- `deal_sba_facts` table missing
- `watchlist_entries` table missing (from a much later 2026-05 migration)

There are likely more. SD-C's first run produces the authoritative list.

This spec (SD-A) lands ONE reconciliation migration that brings the live schema into alignment with what migration history claims is true, then flips SD-C from report-only to blocking. After SD-A, every PR is protected from regressing — and the SBA 30-min pack S1 migration can ship cleanly.

## Build principles captured

**#31 — Reconciliation is one transaction or none.** A partial reconciliation has the same problem as the original drift. The migration uses a single `BEGIN ... COMMIT` block. If any statement fails, the entire reconciliation rolls back and the team investigates rather than leaving the DB in a half-fixed state.

**#32 — Reconciliation creates, never drops.** This spec only ADDs missing objects. If migration history says "drop X" and X exists in production, that's a separate decision (drop ≠ drift). SD-A does not interpret intentional retention; it only fills in what should be there.

**#33 — Application code is the second consumer of canonical state.** Before reconciling the schema, audit application code for usages of the missing objects. If app code reads `sba_policy_rules.fix_suggestions` today, our reconciliation matters; if no code path uses it, the reconciliation is a 1-line allow-list entry instead.

---

## Pre-implementation verification (PIV)

### PIV-1 — SD-C has shipped + is producing reports
Verify CI artifact `drift-report` exists for the latest `main` build. Download `all-findings.json`. This is the input to SD-A. **If the artifact doesn't exist or contains 0 findings, SD-A blocks — surface and investigate.** SD-C's findings are the contract.

### PIV-2 — Categorize findings into action buckets
For each finding in SD-C's report, categorize into one of three buckets:

- **Bucket A: Reconcile.** The object should exist; live DB is wrong. Add to reconciliation migration.
- **Bucket B: Allow-list.** The object was intentionally not created (e.g., dropped in a later migration; created in a code path other than DDL). Add to `.drift-allowlist.json` with a clear `reason`.
- **Bucket C: Investigate.** Don't know yet. Park in a new section of the spec; surface to Matt for decision before bucket assignment.

A draft categorization MUST be reviewed by Matt before reconciliation SQL is written. Surface as `specs/schema-drift/SD-A-bucket-assignment.md` for review.

### PIV-3 — Code usage audit
For every Bucket A finding, grep the codebase:
```sh
# Example for missing column
rg -i "sba_policy_rules.*fix_suggestions|fix_suggestions.*sba_policy_rules" src/
```

Three outcomes per finding:
- **Used:** code references the missing object. Reconciliation IS necessary; failure to reconcile leaves a latent 500.
- **Not used:** no code path references the object. Reconciliation is still good hygiene but lower priority. Demote to Bucket B if the team agrees.
- **Used in DEAD code:** referenced by code that itself is unreachable. Note in reconciliation comments; reconcile to keep schema consistent.

Output: `specs/schema-drift/SD-A-code-audit.md` — one row per Bucket A finding, the code-usage outcome, and any notes.

### PIV-4 — Backup confirmation
Before applying the reconciliation migration to production, confirm:
- Current Supabase auto-backup is recent (< 24h old)
- Manual point-in-time recovery snapshot taken just before apply
- Both confirmed via Supabase dashboard

This is a production schema change. Backup is a hard prerequisite, not a courtesy.

### PIV-5 — Branch DB rehearsal
Apply the reconciliation migration to a Supabase branch DB created from production schema. Run `pnpm gate:schema-drift` against the branch DB; verify drift findings drop to zero (or only allow-listed entries).

If the rehearsal fails, fix and re-rehearse. Do NOT apply to production until rehearsal succeeds.

---

## What's in scope

### A. Bucket assignment document

`specs/schema-drift/SD-A-bucket-assignment.md` — one row per drift finding, three buckets, reasons. Matt reviews and approves before SQL drafting begins. Format:

```md
## Reconcile (Bucket A)

| Migration | Object | Code uses it? | Notes |
|---|---|---|---|
| 20251227000010 | sba_policy_rules.category | yes (3 files) | Required for eligibility engine sort |
| 20251227000010 | sba_policy_rules.fix_suggestions | yes (1 file) | Surfaced in cockpit Story tab |
| ... | ... | ... | ... |

## Allow-list (Bucket B)

| Migration | Object | Reason |
|---|---|---|
| 20251227000010 | ai_run_events table | Intentionally dropped in same migration after rename |
| ... | ... | ... |

## Investigate (Bucket C)

| Migration | Object | Question |
|---|---|---|
| 20260513 | watchlist_entries | Was watchlist_workout migration abandoned? Code references? |
| ... | ... | ... |
```

### B. Reconciliation migration

`supabase/migrations/<date>_reconcile_drift_through_<sd-c-report-date>.sql`

Single transaction. Header documents the SD-C report version that was the input. Body composed of:
1. Missing tables (CREATE TABLE IF NOT EXISTS, with full schema from migration history)
2. Missing columns (ALTER TABLE ADD COLUMN IF NOT EXISTS)
3. Missing indexes (CREATE INDEX IF NOT EXISTS)
4. Missing functions (CREATE OR REPLACE FUNCTION)
5. RLS policies (re-enable on all reconciled tables)
6. Backfill data (only for seed migrations like `20251227000014_seed_sba_rules` whose INSERTs never ran — re-execute the inserts here against the now-fixed schema)

Skeleton structure:

```sql
-- 20260427_reconcile_drift_through_2026_04_27.sql
-- Reconciliation of historical schema drift identified by SD-C drift detector.
-- Input: drift-report artifact from CI build #<XXX> on commit <SHA>
-- Reviewed: SD-A-bucket-assignment.md (commit <SHA>)
-- Approved: Matt 2026-04-XX
--
-- This migration ONLY adds missing objects and re-runs missing seed data.
-- It does NOT drop anything.
--
-- Single transaction: full success or full rollback.

BEGIN;

-- ============================================================
-- 1. Missing tables
-- ============================================================

-- From 20251227000012_sba_god_mode_foundation
CREATE TABLE IF NOT EXISTS public.committee_personas (
  -- ... full DDL copied from foundation migration ...
);

CREATE TABLE IF NOT EXISTS public.deal_sba_difficulty_scores (
  -- ... full DDL ...
);

-- From 20251227000010_fix_schema_mismatches
CREATE TABLE IF NOT EXISTS public.ai_event_citations (
  -- ... full DDL ...
);

-- From 20251227000013_sba_god_mode_stores
CREATE TABLE IF NOT EXISTS public.deal_sba_facts (
  -- ... full DDL ...
);

-- From 20260513_watchlist_workout (assuming Bucket A after PIV-3)
CREATE TABLE IF NOT EXISTS public.watchlist_entries (
  -- ... full DDL ...
);

-- ============================================================
-- 2. Missing columns
-- ============================================================

-- From 20251227000010 §1
ALTER TABLE public.ai_events
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS usage_json jsonb,
  ADD COLUMN IF NOT EXISTS error_message text;

-- From 20251227000010 §3
ALTER TABLE public.bank_policy_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS source_label text;

-- From 20251227000010 §5 (this is the one that blocks SBA S1)
ALTER TABLE public.sba_policy_rules
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS borrower_friendly_explanation text,
  ADD COLUMN IF NOT EXISTS fix_suggestions jsonb,
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ============================================================
-- 3. Missing indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sba_policy_rules_category
  ON public.sba_policy_rules(category);
CREATE INDEX IF NOT EXISTS idx_sba_policy_rules_severity
  ON public.sba_policy_rules(severity);
-- ... etc, all from drift report ...

-- ============================================================
-- 4. Missing functions
-- ============================================================

-- From 20251227000010 §6
CREATE OR REPLACE FUNCTION public.match_bank_policy_chunks(...) ...;

-- ============================================================
-- 5. RLS policies (re-enable on reconciled tables)
-- ============================================================

ALTER TABLE public.committee_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_sba_difficulty_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_event_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_sba_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_entries ENABLE ROW LEVEL SECURITY;
-- ... and so on for every reconciled table ...

-- ============================================================
-- 6. Backfill: re-run failed seed inserts
-- ============================================================

-- 20251227000014_seed_sba_rules attempted to insert 10 rules but failed
-- because the columns it referenced didn't exist.
-- Now that columns are restored (§2 above), retry the inserts.

INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions, sop_reference, severity
) VALUES
  -- ... all 10 rules from 20251227000014_seed_sba_rules.sql ...
ON CONFLICT (program, rule_key) DO NOTHING;

-- ============================================================
-- Verification queries (commented; for manual post-apply check)
-- ============================================================

-- After COMMIT, run pnpm gate:schema-drift locally against the migrated DB.
-- Expected: zero findings (or only allow-listed).

COMMIT;
```

**Note on `effective_date` column:** SD-A's reconciliation adds this column. SBA pack S1's migration ALSO adds it (`ADD COLUMN IF NOT EXISTS effective_date date`). With both shipping, S1's add is a no-op — fine. Both migrations use `IF NOT EXISTS`. No conflict. After SD-A merges, the SBA S1 migration becomes idempotent against the now-correct schema.

### C. Allow-list updates

`.drift-allowlist.json` — add Bucket B entries from PIV-2. Each entry has a `reason` linking back to either the bucket assignment doc or a specific migration that intentionally dropped/superseded the object.

### D. SD-C Phase 2 enablement

`.github/workflows/ci.yml` — same step from SD-C, change one line:

```yaml
- name: Schema drift detection
  if: env.DRIFT_DETECT_DB_URL != ''
- continue-on-error: true     # PHASE 1: report-only, do not block PRs
+ # Phase 2: drift detection now blocks PRs. Allow-list at .drift-allowlist.json
  run: pnpm -s gate:schema-drift
```

This change ships in the SAME PR as the reconciliation migration. Order of execution:
1. PR opens; CI runs against the branch (which still has the old `continue-on-error: true`)
2. CI's drift-detect step runs against production DB (still drifted) — reports drift, doesn't block
3. PR merged to main
4. Reconciliation migration applied to production
5. Re-run CI on main; drift step now reports zero findings, the `continue-on-error: false` change is now active

The branch-time CI run uses the old behavior (report-only). The post-merge reconciliation + re-run flips to blocking. This is the cleanest sequencing — flipping to blocking BEFORE reconciliation would block the reconciliation PR itself.

### E. Application code audit results

`specs/schema-drift/SD-A-code-audit.md` — output of PIV-3. For each Bucket A finding, the file lists every code reference. Used as the post-deploy smoke checklist: after reconciliation lands, hit each referenced code path with a real request and confirm no 500. Format:

```md
## sba_policy_rules.fix_suggestions

References:
- src/lib/sba/eligibility.ts:142 — selected in `evaluateSBAEligibility`
- src/components/cockpit/StoryFixesPanel.tsx:38 — rendered in Story tab

Post-deploy smoke:
- POST /api/deals/<test-deal>/sba/eligibility — confirm response includes `suggested_fixes` array
- Open cockpit for <test-deal> Story tab — confirm fixes panel renders
```

### F. Roadmap entry

`BUDDY_PROJECT_ROADMAP.md` — append a phase entry:

```md
## Phase 88 — Schema Drift Reconciliation (2026-04-XX)

- SD-C shipped: CI drift detection in report-only mode
- SD-A shipped: one-shot reconciliation of historical drift
- SD-C flipped to blocking; every future migration protected
- Build principles #28-#33 captured
```

---

## Tests required

| File | Coverage |
|---|---|
| (existing) `scripts/schema/__tests__/drift-detect.test.ts` | Re-run after reconciliation applied; verify zero blocking findings (or only allow-listed) |

No new unit tests in this spec. The reconciliation migration is verified by:
- PIV-5 branch-DB rehearsal (catches SQL errors)
- V-SDA-d post-apply drift-detect zero result (catches reconciliation incompleteness)
- V-SDA-e application smoke checklist from `SD-A-code-audit.md` (catches code-path regressions)

---

## Verification (V-SDA)

**V-SDA-a — Bucket assignment reviewed**
`specs/schema-drift/SD-A-bucket-assignment.md` exists, reviewed, approved by Matt before SQL writing.

**V-SDA-b — Code audit complete**
`specs/schema-drift/SD-A-code-audit.md` exists; every Bucket A finding has a code-usage outcome.

**V-SDA-c — Branch DB rehearsal succeeded**
Reconciliation migration applied to a Supabase branch DB. `pnpm gate:schema-drift` against the branch reports zero blocking findings.

**V-SDA-d — Production apply succeeded; drift cleared**
After production apply:
```sh
DRIFT_DETECT_DB_URL=<prod> pnpm gate:schema-drift
```
Exit code 0. `.drift_report/blocking-findings.json` is empty (or contains only allow-listed entries).

**V-SDA-e — Application code paths smoke-tested**
For every entry in `SD-A-code-audit.md`, hit the referenced code path with a real request. No 500s.

**V-SDA-f — `sba_policy_rules` populated**
```sql
SELECT count(*) FROM sba_policy_rules;
-- Expected: 10 (the seed migration's 10 rules from 20251227000014, now successfully inserted via §6 backfill)
```

**V-SDA-g — SBA pack S1 migration now applies cleanly**
Apply `20260428_seed_sba_rules_50108.sql` (from SBA pack S1, currently blocked) to the branch DB. Confirm:
- All 22 SOP 50 10 8 INSERTs succeed (`category` and `effective_date` columns now exist)
- 10 SOP 50 10 7(K) rules from the backfill get superseded
- Final state: 22 active SOP 50 10 8 rules, 10 superseded SOP 50 10 7(K) rules

This is the unblock proof for the SBA 30-min pack.

**V-SDA-h — CI drift gate now blocking**
Open a no-op PR after the reconciliation merges. Confirm the `Schema drift detection` step shows as a blocking check (no `continue-on-error`). Mark a benign drift in `.drift-allowlist.json` removal — confirm CI fails. Restore allow-list — confirm CI passes.

**V-SDA-i — `tsc --noEmit` clean, `pnpm lint` clean, `pnpm test` clean**

**V-SDA-j — GitHub API verification post-merge**
- `supabase/migrations/<date>_reconcile_drift_through_<sd-c-report-date>.sql` on main
- `specs/schema-drift/SD-A-bucket-assignment.md` on main
- `specs/schema-drift/SD-A-code-audit.md` on main
- `.github/workflows/ci.yml` updated (no `continue-on-error: true` on drift step)
- `.drift-allowlist.json` updated with Bucket B entries
- `BUDDY_PROJECT_ROADMAP.md` updated with Phase 88

---

## Non-goals

- Investigating WHY drift happened (mechanism in the deploy pipeline) — that's SD-B (deferred follow-up)
- Changing the migration runner / deploy pipeline — out of scope; SD-C catches future drift, SD-A clears past drift; SD-B fixes the leak
- Dropping intentionally-superseded objects — Bucket B (allow-list) handles these without dropping
- Rebuilding the migration history — we accept that history is partially fictional; SD-C protects forward, SD-A reconciles backward, history stays as-is
- Backfilling data beyond seed migrations — if `20251227000014` and similar seed migrations contained INSERTs that didn't run, those are reconciled. Application-data backfills (e.g., re-derive a computed column for existing rows) are out of scope unless explicitly listed in the bucket assignment

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | Reconciliation migration fails partway through | Low | Single `BEGIN ... COMMIT` — full rollback on any error. Branch-DB rehearsal (PIV-5) catches before prod |
| 2 | A reconciled object conflicts with an existing object that has the same name but different shape | Medium | `CREATE TABLE IF NOT EXISTS` is a no-op if table exists. Branch DB rehearsal catches column-shape mismatches. If conflict surfaces, drop the entry from Bucket A → Bucket B (allow-list with reason "exists with different shape; intentional divergence") |
| 3 | Application code breaks because reconciled table now has RLS that was missing | Medium | RLS re-enable in §5 explicit. Code audit (PIV-3) catches code paths that relied on absence of RLS. Test against branch DB with same-role authentication as production |
| 4 | Reconciliation re-creates an object that a later migration intentionally dropped | Medium | Bucket B/C triage in PIV-2 catches this. Reason in allow-list documents the intent |
| 5 | Backfill INSERTs collide with existing data | Low | All backfills use `ON CONFLICT (...) DO NOTHING`. Pre-existing rows preserved |
| 6 | The bucket assignment document grows huge (50+ findings) | Medium | Acceptable. 50 rows of categorization is faster than reproducing the same investigation per-PR for 6 months |
| 7 | SD-C Phase 2 flip blocks an in-flight PR mid-merge | Low | Sequence in §D: branch CI uses Phase 1, post-merge CI uses Phase 2. Drift gate flip ships in same PR as reconciliation, so by the time CI re-runs against `main`, the DB matches the new gate's expectations |
| 8 | Production apply takes longer than expected (large data backfills?) | Low | Reconciliation is mostly DDL + small seed inserts. Estimated <30 seconds. PIV-5 rehearsal measures actual runtime |
| 9 | Pulse fastlane noise from the schema-changes — RLS enable, table creates | Low | These are DDL events, not application events. No `deal_events` writes. No new event types. No fastlane impact |
| 10 | Drift recurs immediately after reconciliation because mechanism not fixed | High | Acceptable trade-off. SD-C catches immediately on next PR. SD-B (future) addresses the mechanism. SD-A keeps schema clean for current PR cycle |

---

## Hand-off commit message

```
spec(schema-drift/sd-a): one-shot historical drift reconciliation

- supabase/migrations/<date>_reconcile_drift_through_<date>.sql:
  single-transaction reconciliation of all drift identified by SD-C report
- specs/schema-drift/SD-A-bucket-assignment.md: per-finding triage
- specs/schema-drift/SD-A-code-audit.md: code-usage analysis per finding
- .drift-allowlist.json: Bucket B entries with reasons
- .github/workflows/ci.yml: SD-C Phase 2 — drift gate now blocking
- BUDDY_PROJECT_ROADMAP.md: Phase 88 entry; build principles #31-#33

Verification: V-SDA-a through V-SDA-j
Spec: specs/schema-drift/SPEC-SD-A-reconciliation.md
```

---

## Addendum for Claude Code

**Judgment boundaries — when to stop and surface:**

- **PIV-1 is non-negotiable.** Do not start SD-A until SD-C has shipped AND produced at least one drift report on `main`. If SD-C just merged and CI hasn't run yet against `main`, wait. Surface and pause; do not work from the manual investigation findings in this spec's Background section as the input — that's a sample, not the authoritative report
- **PIV-2 bucket assignment requires Matt's review before SQL writing.** This is not a courtesy review — Bucket B and C decisions have ongoing consequences (allow-list bloat, deferred investigations). Surface the draft assignment as a separate commit on a branch; wait for explicit approval before drafting the reconciliation SQL
- **PIV-5 branch DB rehearsal is non-negotiable.** Even if the migration looks trivially correct, rehearse on a branch DB. Production apply without rehearsal is the kind of move that turns a recoverable drift into an unrecoverable outage
- **The reconciliation migration ONLY adds. Never drops, never alters existing objects in incompatible ways.** If a Bucket A finding suggests a `DROP COLUMN` or `ALTER COLUMN ... TYPE`, surface — that's a Bucket C item that needs Matt's call. Reconciliation never drops
- **Backfill scope:** §6 of the migration re-runs INSERTs from seed migrations whose statements never executed. If a seed migration's INSERTs partially ran (e.g., 3 of 10 rows landed), use `ON CONFLICT DO NOTHING` to preserve the partial state and complete the rest. Do NOT delete-and-replace — that loses any data that did make it
- **Code audit (PIV-3) is per-finding, not aggregate.** A grep for `sba_policy_rules` returns dozens of hits across the codebase; the audit needs to be specific to which column or table is missing for that finding. Surface the audit doc for review before treating it as complete
- **Phase 2 flip in `ci.yml` ships in the SAME PR as the reconciliation migration.** Don't split into two PRs. The sequencing in §D depends on the atomic merge of (reconciliation + gate flip)
- **If reconciliation rehearsal succeeds but production apply fails:** STOP. Do not retry. Do not rollback half-state. Surface to Matt with the exact error. Production at this point has either succeeded fully (rollback by transaction) or has not changed (transaction never committed). Diagnostic time, not retry time
- **If, after reconciliation, `pnpm gate:schema-drift` still reports findings:** STOP. Either (a) the reconciliation missed something or (b) drift recurred during the apply window. Either way, surface — do not patch over with more allow-list entries
- **If a bucket A finding lists a code reference that's actually unreachable** (e.g., feature-flagged off, dead route): note it in the code-audit doc and reconcile anyway. Schema consistency matters even for unused columns; future code may legitimately add references

**Sequencing for the broader plan (this is step 4 of 6):**

1. ✅ SD-C ships (separate spec) — CI starts reporting drift
2. Wait 1–2 weeks. Confirm CI's drift report is stable (same findings each run). Investigate any non-stable finding before proceeding
3. SD-A bucket assignment drafted (PIV-2) — Matt reviews
4. **SD-A reconciliation migration ships (this spec)** — drift cleared, gate flipped to blocking
5. SBA 30-min pack S1 unblocked — re-attempt the S1 production migration
6. (Future) SD-B investigates the deploy-pipeline mechanism that caused drift in the first place

This spec is step 4. Don't try to compress steps 3–5 into one PR. The bucket assignment review (step 3) genuinely needs to land before SQL drafting starts.

**Open question carried over from SD-C:** the deploy-pipeline mechanism that's been causing drift is still unknown. SD-A reconciles the backlog but doesn't stop new drift from happening. SD-C catches new drift on the PR that introduces it (Phase 2 blocking after this spec). That's good enough for now. SD-B (future) finds the root cause.
