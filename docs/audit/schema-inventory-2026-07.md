# Schema Inventory — 2026-07 (SPEC-SYSTEM-DEBLOAT-1 Phase C1)

**Status:** Inventory only. **Zero DDL in this document or its companion SQL.** Nothing here drops anything.
**Generated:** 2026-07-29, against live production via `the_buddy_supa_mcp`.
**Purpose:** classify every table that `pg_stat_user_tables` reports as empty (`n_live_tup = 0`) into one of four buckets, so that Matt can review and approve a drop list. **This document is the sole authority for Phase C2** — no batch drop migration may cite a table unless this doc (after Matt's review commit) marks it `DROP`.

---

## ⚠️ Critical finding: `n_live_tup = 0` is not reliable evidence of "empty"

The 2026-07-29 audit's headline number — **563 of 650 tables empty** — and my own Phase A §0 re-verification of that number both relied on `pg_stat_user_tables.n_live_tup`. That column is a **planner statistics estimate**, populated by autovacuum/`ANALYZE`. It is **not** a live row count. A table that has never been auto-analyzed reports `n_live_tup = 0` regardless of how much real data it holds.

I verified this the hard way: before doing any classification, I ran an actual `count(*)` against all 564 candidate tables (via a server-side `DO` loop — `pg_stat_user_tables` said 564 tables were empty as of this run, one fewer than the audit's 563/650 baseline reflects a 650→~area total-table drift since 2026-07-07, not a Phase A effect). **81 of those 564 "empty" tables actually contain real rows — 74,976 rows total.** The worst cases:

| Table | `n_live_tup` said | Actual row count |
|---|---:|---:|
| `franchise_sba_directory_snapshots` | 0 | **32,433** |
| `fdd_item19_facts` | 0 | **26,927** |
| `franchise_brands` | 0 | **8,433** |
| `fdd_filings` | 0 | **5,794** |
| `doc_intel_results` | 0 | **178** |
| `doc_gatekeeper_cache` | 0 | **55** |
| `doc_extraction_cache` | 0 | **46** |
| `marketplace_rate_card` | 0 | **44** |
| ...(73 more, 1–261 rows each) | 0 | see table below |

**Every one of these is excluded from DROP consideration in this document, full stop**, regardless of what their code/FK/view/function reference counts show. They are classified `DECIDE-MATT` with an explicit "not actually empty" note. This is a hard override on top of the spec's literal classification rules — the spec's DROP criteria (§C1) only look at code/FK/view/function references, but a table with real production data behind it must never be a drop candidate on reference-count grounds alone.

**Action item for Matt:** the underlying staleness (`last_autovacuum`/`last_autoanalyze` are `NULL` on these tables) suggests autovacuum isn't keeping up, or these tables were bulk-loaded via a path that skips the stats update. Worth an `ANALYZE;` pass across the database independent of this spec — I did not do this myself (no DDL/maintenance actions in this PR), but the 650-table pg_stat_user_tables view should not be trusted again for schema-reap purposes until that happens.

> **Update 2026-07-29, later same day:** Matt asked for `ANALYZE;` to be run against production, and it has been (not part of this PR — no repo changes were needed, it's a stats-only maintenance operation, not DDL). Verified after: all five worst-offender tables above now report accurate `n_live_tup` matching the real counts in this doc exactly (`franchise_sba_directory_snapshots` 32,433, `fdd_item19_facts` 26,927, `franchise_brands` 8,433, `fdd_filings` 5,794, `doc_intel_results` 178). The remaining 483 tables still at `n_live_tup=0` are now trustworthy — with fresh stats, `0` means genuinely empty, not "never analyzed." This doesn't change any classification below (the 81 real-data tables were already correctly excluded from `DROP` via manual `count(*)` overrides), it just means `pg_stat_user_tables` is reliable again going forward.

## Second finding: `services/` is a separate write path from `src/`

The spec's methodology (§C1) specifies grepping `src/` for `.from("<table>")` / `.from('<table>')` as the code-reference signal. That's correct for the main Next.js app, but this repo also has four standalone Node services under `services/` (`franchise-sync-worker`, `franchise-fdd-extractor`, `buddy-core-worker`, `pulse-mcp`) that talk to Postgres directly via `pg.Pool` with raw SQL — never through `src/`, never through `.from()`. A `src/`-only grep would have misclassified `buddy_deal_state`, `buddy_incidents`, and `buddy_observer_events` (all read/written exclusively from `services/pulse-mcp`) as zero-reference DROP candidates.

I extended the code-reference scan to also cover `services/` and `scripts/`, using both the `.from("table")` pattern and a raw-SQL pattern (`FROM`/`INTO`/`UPDATE`/`JOIN "table"`) for those directories. The doc below reports both **Refs (src)** — the spec-literal column — and **Refs (all)** — src + services + scripts — and classification is driven by the **all** column, not src-only, specifically to avoid re-creating the gap above.

This is still not exhaustive: neither pattern catches a table name built from a variable (`` sb.from(tableNameVar) `` or a template literal), and `services/`'s raw-SQL pattern can both over- and under-match (a `JOIN` clause with an unrelated identifier that happens to share a table's name would over-count; a query built entirely from a string concatenated outside the matched keywords would under-count). Treat a `0` in both ref columns as "no reference found by this method," not as a formal proof of non-use.

## Methodology detail

For each of the 564 tables `pg_stat_user_tables` reports as empty (`schemaname='public', n_live_tup=0`), computed:

- **Real rows** — actual `SELECT count(*)`, not `n_live_tup` (see finding above).
- **FK in / FK out** — inbound/outbound foreign-key edges, from `pg_constraint` (`contype='f'`).
- **Views** — views/matviews that depend on the table, via `pg_depend` → `pg_rewrite` → `pg_class`.
- **Fns** — functions in `public` whose `pg_proc.prosrc` contains the table name as a whole word (regex word-boundary match against source text — this can false-positive on a function that merely mentions the name in a comment, and can miss a function that builds the table name dynamically).
- **RLS** — policy count from `pg_policies`. Informational only, not a classification driver: per the audit's own framing, empty tables carrying live RLS surface *is* the bloat, not a reason to keep them.
- **Migration file** — first `supabase/migrations/*.sql` file containing a matching `CREATE TABLE [IF NOT EXISTS] [public.]<table>` (case-insensitive). **164/564 tables have no such file** — per `supabase/migrations/README.md`, this repo has documented drift between locally-tracked migration files and what's actually been applied via MCP `apply_migration` since 2026-03-25; a missing migration file does not mean the table was created outside review, only that its DDL isn't in this tree.
- **Refs (src)** / **Refs (all)** — see finding above.

### Classification rules (applied in this order)

1. `pulse_*` tables → **DECIDE-MATT**, always, regardless of every other signal — non-goal per spec (Omega Prime's DB footprint is Matt's advisory-boundary call, not a mechanical reap). Confirmed 2026-07-29: default to KEEP pending Matt's decision.
2. Real row count > 0 → **DECIDE-MATT** — not actually empty; see critical finding above. Never eligible for DROP.
3. Any FK-in / FK-out / view / function reference → **KEEP-STRUCTURAL**.
4. Any code reference (src, services, or scripts) → **KEEP-PENDING**.
5. Everything else (zero on every signal) → **DROP**.

## Summary

| Classification | Count |
|---|---:|
| **DROP** | 82 |
| KEEP-PENDING | 312 |
| KEEP-STRUCTURAL | 53 |
| DECIDE-MATT | 117 |
| **Total** | 564 |

Of the 117 `DECIDE-MATT`: **37** are `pulse_*` tables (default KEEP per Matt — matches the audit's own "pulse_* tables (37, empty)" count exactly), and **80** are the "actually has real data" override (one table, `pulse_projects`, would qualify for both — it's counted under the `pulse_*` rule since that's checked first).

Of the 82 `DROP` candidates: 66 still carry RLS policies (informational — this is exactly the "live compliance surface on dead tables" bloat the audit flagged, not a reason to reconsider), and 62 have no traceable `CREATE TABLE` in `supabase/migrations/` (see migration-drift note above).

**This is a much smaller number than the audit's original "563 empty tables" framing implied** — because most of those 563 either have real data hidden by stale stats (81), or genuine code/structural dependencies (365 combined KEEP-PENDING + KEEP-STRUCTURAL). Only 82 — about 15% of the original count — show zero signal of any kind.

## Full inventory

_Columns: real row count · inbound/outbound FK edges · dependent views/matviews · referencing functions · RLS policy count · authoring migration file (if traceable) · code references in `src/` only · code references across `src/`+`services/`+`scripts/` · classification · note._

| Table | Real rows | FK in | FK out | Views | Fns | RLS | Migration file | Refs (src) | Refs (all) | Classification | Note |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---|---|
| `aegis_recording_sessions` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `ai_gateway_calls` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `ai_run_events` | 0 | 0 | 0 | 0 | 0 | 0 | 20251227000015_wow_factor_traceability.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `attention_artifacts` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `autonomy_scores` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `bank_asset_text` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `bank_credit_policies` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `bank_profiles` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `banker_focus_sessions` | 0 | 0 | 0 | 0 | 0 | 2 | 20260510_command_center.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `borrower_access_tokens` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `borrower_automation_state` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `borrower_reminder_queue` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `brain_confidence_ledger` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `brain_decision_intents` | 0 | 0 | 0 | 0 | 0 | 3 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `brain_thought_artifacts` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `buddy_research_autonomy_settings` | 0 | 0 | 0 | 0 | 0 | 1 | 20260125999999_research_hardening.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `buddy_research_blocked_sources` | 0 | 0 | 0 | 0 | 0 | 1 | 20260125999999_research_hardening.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `buddy_research_plan_overrides` | 0 | 0 | 0 | 0 | 0 | 1 | 20260125999999_research_hardening.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `buddy_tuning_decisions` | 0 | 0 | 0 | 0 | 0 | 4 | 20260604_phase_66c_live_outcome_dominance.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `capital_allocation_events` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `closing_document_actions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_closing_execution_system.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `dashboard_kpi_snapshots` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000001_banker_dashboard.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `deal_collateral_documents` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_entity_participation_model.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `deal_entity_relationships` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `deal_intercompany_transactions` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `deal_message_suggestions` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `deal_policy_deviations` | 0 | 0 | 0 | 0 | 0 | 4 | 20251219000015_policy_defaults.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `deal_status_history` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000001_banker_dashboard.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `deal_status_summary` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `delegation_contracts` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `delivery_trackers` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_attachment_extraction_state` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_command_home_cache` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_intelligence_prefetch_cache` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_operational_obligations` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_operator_repairs` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_pipeline_jobs` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_sender_profiles` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_situations` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_thread_fact_versions` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_thread_priority_explanations` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `email_thread_truth_current` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `exec_outbox` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `exec_runs` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `exec_steps` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `financial_exception_instances` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_financial_exception_instances.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `franchise_brand_aliases` | 0 | 0 | 0 | 0 | 0 | 2 | 20260422_franchise_intelligence_foundation.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `ledger_fiscal_periods` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `overlay_generated_claims` | 0 | 0 | 0 | 0 | 0 | 1 | 20251227000003_bank_overlays.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `owner_portal_invites` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `owner_portal_messages` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `owner_portal_threads` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `peis_advantage_briefs` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `peis_anticipated_needs` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `peis_intelligence_objects` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `peis_mission_objects` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `peis_object_evidence` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `peis_result_quality` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `peis_routing_preferences` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `peis_signal_mesh` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `peis_voice_results` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `portfolio_signals` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_portfolio_intelligence.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `proposed_actions` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `regulatory_sources` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `relationship_decision_transitions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_special_assets_hardening.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `relationship_focus_sessions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_relationship_command_surface.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `risk_factors` | 0 | 0 | 0 | 0 | 0 | 1 | 20251226999999_explainable_risk_memo.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `rule_evaluation_runs` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `sba_servicing_events` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `skill_evolution_proposals` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `skill_failure_logs` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `sms_ledger` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `sms_subscriptions` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `support_session_events` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `support_sessions` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `tenants` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000012_production_sba_system.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `third_brain_ambient_cache` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `underwriting_drift_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260601_underwriting_launch_control.sql | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `user_identities` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `voice_session_summaries` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `workflow_runs` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `xp_logs` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DROP** | zero code refs (src/, services/, scripts/), zero FK, zero view/function refs, zero real rows |
| `agent_approval_events` | 0 | 0 | 0 | 0 | 0 | 4 | 20260413_phase_73_agent_approval_events.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `agent_claims` | 0 | 0 | 0 | 0 | 0 | 1 | 20251227000002_agent_arbitration.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `agent_findings` | 0 | 0 | 0 | 0 | 0 | 1 | 20251227000001_create_agent_findings.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `agent_skill_evolutions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260413_phase_71b_agent_skill_evolutions.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `ai_run_citations` | 0 | 0 | 0 | 0 | 0 | 0 | 20251227000011_post_merge_upgrades.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `ar_aging_invoices` | 0 | 0 | 0 | 0 | 0 | 1 | 20260606_ar_collateral.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `arbitration_decisions` | 0 | 0 | 0 | 0 | 0 | 1 | 20251227000002_agent_arbitration.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `autonomous_events` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `bank_assets` | 0 | 0 | 0 | 0 | 0 | 4 | *(none found)* | 4 | 5 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `bank_attestation_policies` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000002_bank_attestation_policies.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `bank_config_versions` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `bank_credit_committee_members` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000007_credit_committee_voting.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `bank_credit_committee_policies` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000006_credit_committee_policies.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `bank_document_fill_runs` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000011_pdf_autofill.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `bank_document_template_fields` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000011_pdf_autofill.sql | 9 | 9 | **KEEP-PENDING** | 9 code reference(s) in src/ |
| `bank_match_hints` | 0 | 0 | 0 | 0 | 0 | 2 | 20251219000001_bank_match_hints.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `bank_overlays` | 0 | 0 | 0 | 0 | 0 | 1 | 20251227000003_bank_overlays.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `bank_policy_defaults` | 0 | 0 | 0 | 0 | 0 | 4 | 20251219000015_policy_defaults.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `bank_policy_packs` | 0 | 0 | 0 | 0 | 0 | 1 | 20260127000003_examiner_access_grants.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `bank_policy_rule_citations` | 0 | 0 | 0 | 0 | 0 | 1 | 20251219000014_policy_aware_underwriting.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `bank_policy_rules` | 0 | 0 | 0 | 0 | 0 | 2 | 20251219000014_policy_aware_underwriting.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `bank_registry_pins` | 0 | 0 | 0 | 0 | 0 | 1 | 20260215_bank_registry_pins.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `bank_template_field_maps` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `bank_users` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 10 | 10 | **KEEP-PENDING** | 10 code reference(s) in src/ |
| `banker_queue_acknowledgements` | 0 | 0 | 0 | 0 | 0 | 2 | 20260510_command_center.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `banker_queue_snapshots` | 0 | 0 | 0 | 0 | 0 | 2 | 20260510_command_center.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `board_risk_reports` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000009_final_optional_features.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `borrower_answers` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `borrower_applicant_financials` | 0 | 0 | 0 | 0 | 0 | 4 | 20260425_borrower_applicant_financials.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `borrower_attachments` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 14 | 13 | **KEEP-PENDING** | 14 code reference(s) in src/ |
| `borrower_bank_accounts` | 0 | 0 | 0 | 0 | 0 | 4 | 20260429_c_borrower_bank_connections.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `borrower_bank_connections` | 0 | 0 | 0 | 0 | 0 | 4 | 20260429_c_borrower_bank_connections.sql | 8 | 8 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `borrower_bank_match_priors` | 0 | 0 | 0 | 0 | 0 | 0 | 20251219000023_template_library.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `borrower_bank_transactions` | 0 | 0 | 0 | 0 | 0 | 4 | 20260429_c_borrower_bank_connections.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `borrower_caivrs_checks` | 0 | 0 | 0 | 0 | 0 | 4 | 20260520_b_borrower_caivrs_sam.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `borrower_comms` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000012_production_sba_system.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `borrower_credit_pulls` | 0 | 0 | 0 | 0 | 0 | 4 | 20260520_a_borrower_credit_pulls.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `borrower_credit_tradelines` | 0 | 0 | 0 | 0 | 0 | 4 | 20260520_a_borrower_credit_pulls.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `borrower_identity_verifications` | 0 | 0 | 0 | 0 | 0 | 4 | 20260512_borrower_identity_verifications.sql | 13 | 13 | **KEEP-PENDING** | 13 code reference(s) in src/ |
| `borrower_inbox_auto_attach_run_items` | 0 | 0 | 0 | 0 | 0 | 0 | 20251220000003_borrower_inbox_auto_attach_undo.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `borrower_inbox_auto_attach_runs` | 0 | 0 | 0 | 0 | 0 | 0 | 20251220000003_borrower_inbox_auto_attach_undo.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `borrower_irs_transcript_requests` | 0 | 0 | 0 | 0 | 0 | 4 | 20260520_c_borrower_irs_transcripts.sql | 11 | 11 | **KEEP-PENDING** | 11 code reference(s) in src/ |
| `borrower_match_hints` | 0 | 0 | 0 | 0 | 0 | 0 | 20251219000003_borrower_match_hints.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `borrower_nudges` | 0 | 0 | 0 | 0 | 0 | 1 | 20260102000002_lender_packaging_borrower_nudges.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `borrower_owner_attestations` | 0 | 0 | 0 | 0 | 0 | 1 | 20260127000001_borrower_confidence_attestation.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `borrower_pack_applications` | 0 | 0 | 0 | 0 | 0 | 0 | 20251220000017_pack_integration_canonical.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `borrower_pack_template_items` | 0 | 0 | 0 | 0 | 0 | 0 | 20251219000013_pack_templates.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `borrower_pfs_notes_payable` | 0 | 0 | 0 | 0 | 0 | 2 | 20260718000000_sba_form_field_coverage_expansion.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `borrower_pfs_real_estate` | 0 | 0 | 0 | 0 | 0 | 2 | 20260718000000_sba_form_field_coverage_expansion.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `borrower_pfs_securities` | 0 | 0 | 0 | 0 | 0 | 2 | 20260718000000_sba_form_field_coverage_expansion.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `borrower_phone_links` | 0 | 0 | 0 | 0 | 0 | 0 | 20251229000000_borrower_phone_links.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `borrower_portal_events` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `borrower_reminder_schedule` | 0 | 0 | 0 | 0 | 0 | 1 | 20260328_borrower_orchestration.sql | 11 | 11 | **KEEP-PENDING** | 11 code reference(s) in src/ |
| `borrower_request_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260328_borrower_orchestration.sql | 10 | 10 | **KEEP-PENDING** | 10 code reference(s) in src/ |
| `borrower_request_items` | 0 | 0 | 0 | 0 | 0 | 1 | 20260328_borrower_orchestration.sql | 16 | 16 | **KEEP-PENDING** | 16 code reference(s) in src/ |
| `borrower_request_packs` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `borrower_requirements_snapshots` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 7 | 6 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `borrower_sam_exclusions` | 0 | 0 | 0 | 0 | 0 | 4 | 20260520_b_borrower_caivrs_sam.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `borrower_upload_extractions` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `borrower_upload_inbox` | 0 | 0 | 0 | 0 | 0 | 0 | 20251219000013_pack_templates.sql | 12 | 12 | **KEEP-PENDING** | 12 code reference(s) in src/ |
| `brokerage_alert_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260624_brk_10l_alerting.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `brokerage_alert_subscriptions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260624_brk_10l_alerting.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `brokerage_alerts` | 0 | 0 | 0 | 0 | 0 | 1 | 20260624_brk_10l_alerting.sql | 10 | 10 | **KEEP-PENDING** | 10 code reference(s) in src/ |
| `brokerage_borrower_message_outbox` | 0 | 0 | 0 | 0 | 0 | 1 | 20260626_brk_10o_borrower_comms.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `brokerage_closing_conditions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260622_brk_10h_closing_coordination.sql | 14 | 16 | **KEEP-PENDING** | 14 code reference(s) in src/ |
| `brokerage_closing_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260622_brk_10h_closing_coordination.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `brokerage_closing_workflows` | 0 | 0 | 0 | 0 | 0 | 1 | 20260622_brk_10h_closing_coordination.sql | 12 | 14 | **KEEP-PENDING** | 12 code reference(s) in src/ |
| `brokerage_commission_splits` | 0 | 0 | 0 | 0 | 0 | 1 | 20260717050000_crm_intelligence_revenue_command_center.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `brokerage_comms_outbox` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 13 | 13 | **KEEP-PENDING** | 13 code reference(s) in src/ |
| `brokerage_condition_evidence` | 0 | 0 | 0 | 0 | 0 | 1 | 20260622_brk_10h_closing_coordination.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `brokerage_conversion_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260625_brk_10n_conversion_funnel.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `brokerage_disclosures` | 0 | 0 | 0 | 0 | 0 | 1 | 20260621_brk_10e_compliance_package.sql | 4 | 6 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `brokerage_fee_ledger` | 0 | 0 | 0 | 0 | 0 | 1 | 20260621_brk_10e_compliance_package.sql | 25 | 27 | **KEEP-PENDING** | 25 code reference(s) in src/ |
| `brokerage_funding_verifications` | 0 | 0 | 0 | 0 | 0 | 1 | 20260623_brk_10i_revenue_ops.sql | 7 | 9 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `brokerage_lender_message_outbox` | 0 | 0 | 0 | 0 | 0 | 1 | 20260627_brk_10p_lender_comms.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `brokerage_notification_outbox` | 0 | 0 | 0 | 0 | 0 | 1 | 20260624_brk_10l_alerting.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `brokerage_revenue_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260623_brk_10i_revenue_ops.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `brokerage_tasks` | 0 | 0 | 0 | 0 | 0 | 1 | 20260717030000_crm_deal_execution_stage_gates.sql | 13 | 13 | **KEEP-PENDING** | 13 code reference(s) in src/ |
| `buddy_action_recommendations` | 0 | 0 | 0 | 0 | 0 | 4 | 20260603_phase_66b_experience_layer.sql | 8 | 8 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `buddy_advisor_feedback` | 0 | 0 | 0 | 0 | 0 | 4 | 20260606050000_create_buddy_advisor_feedback.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `buddy_agent_handoffs` | 0 | 0 | 0 | 0 | 0 | 4 | 20260603_phase_66b_experience_layer.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `buddy_agent_sessions` | 0 | 0 | 0 | 0 | 0 | 4 | 20260602_phase_66a_multi_agent_control_plane.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `buddy_banker_trust_events` | 0 | 0 | 0 | 0 | 0 | 4 | 20260604_phase_66c_live_outcome_dominance.sql | 9 | 9 | **KEEP-PENDING** | 9 code reference(s) in src/ |
| `buddy_borrower_actions_taken` | 0 | 0 | 0 | 0 | 0 | 4 | 20260604_phase_66c_live_outcome_dominance.sql | 9 | 9 | **KEEP-PENDING** | 9 code reference(s) in src/ |
| `buddy_borrower_insight_runs` | 0 | 0 | 0 | 0 | 0 | 4 | 20260602_phase_66a_multi_agent_control_plane.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `buddy_borrower_readiness_paths` | 0 | 0 | 0 | 0 | 0 | 4 | 20260603_phase_66b_experience_layer.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `buddy_borrower_reports` | 0 | 0 | 0 | 0 | 0 | 2 | 20260516_borrower_health_reports.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `buddy_borrower_stories` | 0 | 0 | 0 | 0 | 0 | 1 | 20260421_borrower_stories_plan_enhancement.sql | 2 | 4 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `buddy_conclusion_trust` | 0 | 0 | 0 | 0 | 0 | 4 | 20260603_phase_66b_experience_layer.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `buddy_covenant_overrides` | 0 | 0 | 0 | 0 | 0 | 1 | 20260515_covenant_packages.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `buddy_deal_state` | 0 | 0 | 0 | 0 | 0 | 1 | 202601280001_buddy_observability.sql | 0 | 3 | **KEEP-PENDING** | 3 code reference(s) in services/ or scripts/ (zero in src/ — worker/service-only table) |
| `buddy_eval_runs` | 0 | 0 | 0 | 0 | 0 | 1 | 20260514_validation_and_eval.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `buddy_eval_scores` | 0 | 0 | 0 | 0 | 0 | 1 | 20260514_validation_and_eval.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `buddy_experiment_assignments` | 0 | 0 | 0 | 0 | 0 | 4 | 20260604_phase_66c_live_outcome_dominance.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `buddy_experiments` | 0 | 0 | 0 | 0 | 0 | 1 | 20260604_phase_66c_live_outcome_dominance.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `buddy_feasibility_studies` | 0 | 0 | 0 | 0 | 0 | 2 | 20260421_03_feasibility_studies.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `buddy_feedback_events` | 0 | 0 | 0 | 0 | 0 | 4 | 20260604_phase_66c_live_outcome_dominance.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `buddy_guarantor_cashflow` | 0 | 0 | 0 | 0 | 0 | 2 | 20260420_business_plan_god_tier_guarantor_cashflow.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `buddy_incidents` | 0 | 0 | 0 | 0 | 0 | 1 | 202601280001_buddy_observability.sql | 0 | 3 | **KEEP-PENDING** | 3 code reference(s) in services/ or scripts/ (zero in src/ — worker/service-only table) |
| `buddy_intel_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000005_buddy_intel_events.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `buddy_material_change_events` | 0 | 0 | 0 | 0 | 0 | 4 | 20260603_phase_66b_experience_layer.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `buddy_monitoring_signals` | 0 | 0 | 0 | 0 | 0 | 4 | 20260603_phase_66b_experience_layer.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `buddy_outcome_events` | 0 | 0 | 0 | 0 | 0 | 4 | 20260604_phase_66c_live_outcome_dominance.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `buddy_outcome_snapshots` | 0 | 0 | 0 | 0 | 0 | 4 | 20260604_phase_66c_live_outcome_dominance.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `buddy_ratio_explanations` | 0 | 0 | 0 | 0 | 0 | 4 | 20260602_phase_66a_multi_agent_control_plane.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `buddy_readiness_uplift_snapshots` | 0 | 0 | 0 | 0 | 0 | 4 | 20260604_phase_66c_live_outcome_dominance.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `buddy_recommendation_outcomes` | 0 | 0 | 0 | 0 | 0 | 4 | 20260604_phase_66c_live_outcome_dominance.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `buddy_research_checkpoints` | 0 | 0 | 0 | 0 | 0 | 4 | 20260602_phase_66a_multi_agent_control_plane.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `buddy_research_failure_library` | 0 | 0 | 0 | 0 | 0 | 1 | 20260602_phase_66a_multi_agent_control_plane.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `buddy_research_intent_log` | 0 | 0 | 0 | 0 | 0 | 4 | 20260126100000_buddy_research_planner.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `buddy_research_thread_runs` | 0 | 0 | 0 | 0 | 0 | 4 | 20260602_phase_66a_multi_agent_control_plane.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `buddy_sba_packages` | 0 | 0 | 0 | 0 | 0 | 1 | 20260329_sba_borrower_readiness.sql | 22 | 24 | **KEEP-PENDING** | 22 code reference(s) in src/ |
| `buddy_sealed_packages` | 0 | 0 | 0 | 0 | 0 | 1 | 20260429_sealing_and_listings.sql | 13 | 15 | **KEEP-PENDING** | 13 code reference(s) in src/ |
| `buddy_shadow_brain_results` | 0 | 0 | 0 | 0 | 0 | 1 | 20260118000000_buddy_shadow_brain_results.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `buddy_trident_bundles` | 0 | 0 | 0 | 0 | 0 | 1 | 20260427_trident_bundles.sql | 16 | 18 | **KEEP-PENDING** | 16 code reference(s) in src/ |
| `buddy_tuning_candidates` | 0 | 0 | 0 | 0 | 0 | 4 | 20260604_phase_66c_live_outcome_dominance.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `buddy_validation_reports` | 0 | 0 | 0 | 0 | 0 | 2 | 20260514_validation_and_eval.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `builder_decisions` | 0 | 0 | 0 | 0 | 0 | 2 | 20260504_policy_ingestion_decision_memory.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `claim_conflict_sets` | 0 | 0 | 0 | 0 | 0 | 1 | 20251227000002_agent_arbitration.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `classification_shadow_log` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `closing_checklist_items` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_closing_package_foundation.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `closing_condition_states` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_closing_execution_system.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `closing_document_recipients` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_closing_execution_system.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `closing_document_renders` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_closing_render_spine.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `closing_execution_runs` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_closing_execution_system.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `closing_package_documents` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_closing_package_foundation.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `closing_packages` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_closing_package_foundation.sql | 8 | 8 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `condition_document_links` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_condition_document_links.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `condition_evidence_reviews` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_condition_evidence_reviews.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `condition_message_throttles` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000008_messaging_system.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `condition_messages` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000008_messaging_system.sql | 16 | 16 | **KEEP-PENDING** | 16 code reference(s) in src/ |
| `conditions_to_close` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 18 | 18 | **KEEP-PENDING** | 18 code reference(s) in src/ |
| `counterfactual_decisions` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000009_final_optional_features.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `credit_action_recommendations` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_credit_action_recommendations.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `credit_committee_dissent` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000005_committee_minutes_dissent.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `credit_committee_minutes` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000005_committee_minutes_dissent.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `credit_committee_votes` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000007_credit_committee_voting.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `credit_discovery_answers` | 0 | 0 | 0 | 0 | 0 | 4 | 20251220000004_buddy_credit_discovery_ai_everywhere.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `credit_discovery_facts` | 0 | 0 | 0 | 0 | 0 | 4 | 20251220000004_buddy_credit_discovery_ai_everywhere.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `credit_discovery_sessions` | 0 | 0 | 0 | 0 | 0 | 4 | 20251220000004_buddy_credit_discovery_ai_everywhere.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `credit_memo_citations` | 0 | 0 | 0 | 0 | 0 | 2 | 20251220000013_evidence_v3_pdf_page_map_and_memo_citations.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `credit_memo_drafts` | 0 | 0 | 0 | 0 | 0 | 2 | 20251220000013_evidence_v3_pdf_page_map_and_memo_citations.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `crm_activity_participants` | 0 | 0 | 0 | 0 | 0 | 1 | 20260717040000_crm_communications_automation_engine.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `crm_merge_log` | 0 | 0 | 0 | 0 | 0 | 1 | 20260717000000_crm_unified_relationship_graph.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `crm_sequence_enrollments` | 0 | 0 | 0 | 0 | 0 | 1 | 20260717040000_crm_communications_automation_engine.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `deal_action_executions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_operating_spine.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_annual_review_cases` | 0 | 0 | 0 | 0 | 0 | 2 | 20260512_annual_review_renewal_engine.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `deal_annual_reviews` | 0 | 0 | 0 | 0 | 0 | 2 | 20260511_post_close_monitoring.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `deal_audit_log` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_deal_initialization_document_truth.sql | 9 | 9 | **KEEP-PENDING** | 9 code reference(s) in src/ |
| `deal_auto_advance_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260328_sla_tempo_auto_advance.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_bank_links` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_brokerage_stage_transitions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260717030000_crm_deal_execution_stage_gates.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `deal_builder_submissions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_builder_readiness_secure_intake.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_committee_decisions` | 0 | 0 | 0 | 0 | 0 | 2 | 20260507_structure_governance.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_condition_evidence` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_consolidations` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_covenants` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_operating_spine.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `deal_credit_memos` | 0 | 0 | 0 | 0 | 0 | 3 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_decision_finalization` | 0 | 0 | 0 | 0 | 0 | 2 | 20260509_memo_decision_closeout.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_distribution_actions` | 0 | 0 | 0 | 0 | 0 | 2 | 20260508_distribution_layer.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_distribution_snapshots` | 0 | 0 | 0 | 0 | 0 | 2 | 20260508_distribution_layer.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_doc_mappings` | 0 | 0 | 0 | 0 | 0 | 2 | 20260113000000_ai_doc_mapping.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_document_audit_certificates` | 0 | 0 | 0 | 0 | 0 | 4 | 20260429_proof_of_correctness_tables.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `deal_document_receipts` | 0 | 0 | 0 | 0 | 0 | 4 | 20251220000002_borrower_guided_upload_mode.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_entity_documents` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_entity_participation_model.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_entity_participations` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_entity_participation_model.sql | 9 | 9 | **KEEP-PENDING** | 9 code reference(s) in src/ |
| `deal_escalation_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260328_sla_tempo_auto_advance.sql | 8 | 8 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `deal_existing_debt_schedule` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 8 | 9 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `deal_extraction_exceptions` | 0 | 0 | 0 | 0 | 0 | 4 | 20260429_proof_of_correctness_tables.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_fact_conflicts` | 0 | 0 | 0 | 0 | 0 | 1 | 20260502_financial_review_resolution.sql | 11 | 12 | **KEEP-PENDING** | 11 code reference(s) in src/ |
| `deal_flag_send_packages` | 0 | 0 | 0 | 0 | 0 | 2 | 20260306000003_flag_send_packages.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_intake_scenario` | 0 | 0 | 0 | 0 | 0 | 1 | 20260711_backfill_intake_slot_tables.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `deal_intelligence_runs` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_auto_intelligence_pipeline.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `deal_intelligence_steps` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_auto_intelligence_pipeline.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `deal_loan_decisions` | 0 | 0 | 0 | 0 | 0 | 2 | 20260509_memo_decision_closeout.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_message_drafts` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000022_underwrite_guard_automation.sql | 18 | 18 | **KEEP-PENDING** | 18 code reference(s) in src/ |
| `deal_message_reads` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000006_chat_and_checklist_highlight.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_messages` | 0 | 0 | 0 | 0 | 0 | 4 | 20251220000006_chat_and_checklist_highlight.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `deal_methodology_choices` | 0 | 0 | 0 | 0 | 0 | 2 | 20260615000001_deal_methodology_choices.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_missing_docs` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_monitoring_cycles` | 0 | 0 | 0 | 0 | 0 | 2 | 20260511_post_close_monitoring.sql | 14 | 14 | **KEEP-PENDING** | 14 code reference(s) in src/ |
| `deal_monitoring_exceptions` | 0 | 0 | 0 | 0 | 0 | 2 | 20260511_post_close_monitoring.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `deal_monitoring_obligations` | 0 | 0 | 0 | 0 | 0 | 2 | 20260511_post_close_monitoring.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `deal_monitoring_programs` | 0 | 0 | 0 | 0 | 0 | 2 | 20260511_post_close_monitoring.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `deal_monitoring_seeds` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_operating_spine.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `deal_next_actions` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000022_underwrite_guard_automation.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `deal_outbound_ledger` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000006_mega_step_12_outbound.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_outbound_settings` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000006_mega_step_12_outbound.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `deal_owner_checklist_items` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000009_deal_ownership_and_owner_portals.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `deal_owner_checklist_state` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000009_deal_ownership_and_owner_portals.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `deal_owner_outreach_queue` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000009_deal_ownership_and_owner_portals.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `deal_owner_portals` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000009_deal_ownership_and_owner_portals.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_owners` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000009_deal_ownership_and_owner_portals.sql | 8 | 8 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `deal_ownership_findings` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000015_ownership_findings.sql | 8 | 8 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `deal_ownership_interests` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `deal_participant_events` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000010_participant_events.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_pii_records` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_builder_readiness_secure_intake.sql | 17 | 17 | **KEEP-PENDING** | 17 code reference(s) in src/ |
| `deal_policy_exception_actions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260505_committee_exception_workflow.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_policy_exceptions` | 0 | 0 | 0 | 0 | 0 | 2 | 20260505_committee_exception_workflow.sql | 12 | 12 | **KEEP-PENDING** | 12 code reference(s) in src/ |
| `deal_portal_chat_messages` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000002_borrower_guided_upload_mode.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `deal_portal_checklist_state` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000002_borrower_guided_upload_mode.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_portal_share_links` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000018_portal_share_links.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_predictions` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000001_banker_dashboard.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_pricing_explainability` | 0 | 0 | 0 | 0 | 0 | 1 | 20260117002001_pricing_explain_lock_export.sql | 8 | 8 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `deal_pricing_memo_blocks` | 0 | 0 | 0 | 0 | 0 | 1 | 20260117002001_pricing_explain_lock_export.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `deal_primary_action_history` | 0 | 0 | 0 | 0 | 0 | 1 | 20260328_sla_tempo_auto_advance.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `deal_reminder_events` | 0 | 0 | 0 | 0 | 0 | 0 | 20251219000018_step15_reminders.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_reminder_runs` | 0 | 0 | 0 | 0 | 0 | 0 | 20251219000009_deal_reminder_runs.sql | 23 | 23 | **KEEP-PENDING** | 23 code reference(s) in src/ |
| `deal_renewal_cases` | 0 | 0 | 0 | 0 | 0 | 2 | 20260512_annual_review_renewal_engine.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `deal_renewal_prep` | 0 | 0 | 0 | 0 | 0 | 2 | 20260511_post_close_monitoring.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `deal_rent_roll_rows` | 0 | 0 | 0 | 0 | 0 | 2 | 20260116140000_deal_rent_roll_rows.sql | 8 | 8 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `deal_reporting_requirements` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_operating_spine.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `deal_required_documents` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_review_case_exceptions` | 0 | 0 | 0 | 0 | 0 | 2 | 20260512_annual_review_renewal_engine.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `deal_review_case_outputs` | 0 | 0 | 0 | 0 | 0 | 2 | 20260512_annual_review_renewal_engine.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_review_case_requirements` | 0 | 0 | 0 | 0 | 0 | 2 | 20260512_annual_review_renewal_engine.sql | 10 | 10 | **KEEP-PENDING** | 10 code reference(s) in src/ |
| `deal_sba_eligibility` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_sla_snapshots` | 0 | 0 | 0 | 0 | 0 | 1 | 20260328_sla_tempo_auto_advance.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_structuring_freeze` | 0 | 0 | 0 | 0 | 0 | 2 | 20260507_structure_governance.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_structuring_selections` | 0 | 0 | 0 | 0 | 0 | 2 | 20260507_structure_governance.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_truth_events` | 0 | 0 | 0 | 0 | 0 | 2 | 20251227000004_deal_truth_events.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_truth_snapshots` | 0 | 0 | 0 | 0 | 0 | 1 | 20251227000002_agent_arbitration.sql | 14 | 14 | **KEEP-PENDING** | 14 code reference(s) in src/ |
| `deal_underwrite_guard_states` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000022_underwrite_guard_automation.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `deal_underwrite_inputs` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000014_loan_requests.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_watchlist_cases` | 0 | 0 | 0 | 0 | 0 | 2 | 20260513_watchlist_workout.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `deal_watchlist_events` | 0 | 0 | 0 | 0 | 0 | 2 | 20260513_watchlist_workout.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `deal_watchlist_reasons` | 0 | 0 | 0 | 0 | 0 | 1 | 20260513_watchlist_workout.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `deal_webhooks` | 0 | 0 | 0 | 0 | 0 | 0 | 20260102000000_deal_readiness_mega_spec.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `deal_workout_action_items` | 0 | 0 | 0 | 0 | 0 | 2 | 20260513_watchlist_workout.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `deal_workout_cases` | 0 | 0 | 0 | 0 | 0 | 2 | 20260513_watchlist_workout.sql | 9 | 9 | **KEEP-PENDING** | 9 code reference(s) in src/ |
| `deal_workout_events` | 0 | 0 | 0 | 0 | 0 | 2 | 20260513_watchlist_workout.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `decision_overrides` | 0 | 0 | 0 | 0 | 0 | 0 | 20251229000003_decision_os_safe.sql | 11 | 11 | **KEEP-PENDING** | 11 code reference(s) in src/ |
| `doc_extractions` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000003_borrower_portal_e2e.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `doc_fields` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000003_borrower_portal_e2e.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `doc_submissions` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000003_borrower_portal_e2e.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `doc_text_sources` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000011_doc_text_discovery_and_ownership_evidence.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `document_ocr_page_map` | 0 | 0 | 0 | 0 | 0 | 2 | 20251220000013_evidence_v3_pdf_page_map_and_memo_citations.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `document_ocr_words` | 0 | 0 | 0 | 0 | 0 | 2 | 20251220000012_evidence_v3_geometry_word_boxes.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `document_substitutions` | 0 | 0 | 0 | 0 | 0 | 1 | 20251227000006_connect_accounts.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `entity_relationships` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `etran_readiness` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000012_production_sba_system.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `etran_submissions` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000012_production_sba_system.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `examiner_access_grants` | 0 | 0 | 0 | 0 | 0 | 1 | 20260127000003_examiner_access_grants.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `examiner_activity_log` | 0 | 0 | 0 | 0 | 0 | 1 | 20260127000003_examiner_access_grants.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `extraction_correction_log` | 0 | 0 | 0 | 0 | 0 | 4 | 20260430000001_golden_corpus_learning_loop.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `extraction_learning_reports` | 0 | 0 | 0 | 0 | 0 | 4 | 20260430000001_golden_corpus_learning_loop.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `filled_bank_documents` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `financial_review_resolutions` | 0 | 0 | 0 | 0 | 0 | 2 | 20260502_financial_review_resolution.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `financial_snapshot_facts` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_financial_snapshot_validation.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `funding_authorizations` | 0 | 0 | 0 | 0 | 0 | 1 | 20260326_closing_execution_system.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `generated_documents` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000012_production_sba_system.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `lender_invoice_line_items` | 0 | 0 | 0 | 0 | 0 | 1 | 20260709212825_brokerage_billing_lender_invoices.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `lender_invoice_payments` | 0 | 0 | 0 | 0 | 0 | 1 | 20260709212825_brokerage_billing_lender_invoices.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `loan_request_facilities` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_deal_control_layer.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `loan_requests` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_deal_control_layer.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `marketplace_audit_log` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `marketplace_package_access` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 8 | 9 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `marketplace_picks` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 9 | 12 | **KEEP-PENDING** | 9 code reference(s) in src/ |
| `ops_incident_actions` | 0 | 0 | 0 | 0 | 0 | 0 | 20251219000011_ops_incidents.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `ops_incidents` | 0 | 0 | 0 | 0 | 0 | 0 | 20251219000011_ops_incidents.sql | 10 | 10 | **KEEP-PENDING** | 10 code reference(s) in src/ |
| `ops_notification_outbox` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `orchestrator_shadow_log` | 0 | 0 | 0 | 0 | 0 | 1 | 20260312_orchestrator_shadow_log.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `orphan_findings` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `overlay_application_log` | 0 | 0 | 0 | 0 | 0 | 1 | 20251227000003_bank_overlays.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `policy_chunk_versions` | 0 | 0 | 0 | 0 | 0 | 0 | 20251229000003_decision_os_safe.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `policy_drift_findings` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000009_final_optional_features.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `policy_extracted_rules` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000007_credit_committee_voting.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `policy_update_suggestions` | 0 | 0 | 0 | 0 | 0 | 0 | 20251228000009_final_optional_features.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `pricing_grid_rows` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000019_risk_pricing_engine.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `pricing_overrides` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000019_risk_pricing_engine.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `pricing_policies` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000019_risk_pricing_engine.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `pricing_quotes` | 0 | 0 | 0 | 0 | 0 | 4 | 20251220000004_buddy_credit_discovery_ai_everywhere.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `qa_click_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260117000001_qa_sandbox_support.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `relationship_autonomy_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_autonomous_assist.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `relationship_autonomy_execution_log` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_autonomous_assist.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `relationship_autonomy_plans` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_autonomous_assist.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `relationship_autonomy_profiles` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_autonomous_assist.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `relationship_crypto_collateral_positions` | 0 | 0 | 0 | 0 | 0 | 1 | 20260530_relationship_crypto_extension.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `relationship_crypto_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260530_relationship_crypto_extension.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `relationship_crypto_margin_events` | 0 | 0 | 0 | 0 | 0 | 1 | 20260530_relationship_crypto_extension.sql | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `relationship_crypto_monitoring_programs` | 0 | 0 | 0 | 0 | 0 | 1 | 20260530_relationship_crypto_extension.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `relationship_crypto_price_snapshots` | 0 | 0 | 0 | 0 | 0 | 1 | 20260530_relationship_crypto_extension.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `relationship_crypto_protection_cases` | 0 | 0 | 0 | 0 | 0 | 1 | 20260530_relationship_crypto_extension.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `relationship_distress_rollups` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_special_assets_hardening.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `relationship_portfolio_score_snapshots` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_portfolio_intelligence.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `relationship_portfolio_scores` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_portfolio_intelligence.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `relationship_surface_acknowledgements` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_relationship_command_surface.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `relationship_surface_snapshots` | 0 | 0 | 0 | 0 | 0 | 1 | 20260531_relationship_command_surface.sql | 8 | 8 | **KEEP-PENDING** | 8 code reference(s) in src/ |
| `rule_set_versions` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `rule_sets` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `sandbox_access_allowlist` | 0 | 0 | 0 | 0 | 0 | 1 | 20260117000001_qa_sandbox_support.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `sba_etran_submissions` | 0 | 0 | 0 | 0 | 0 | 4 | 20260605_c_etran_credentials.sql | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `sba_form_159_records` | 0 | 0 | 0 | 0 | 0 | 1 | 20260621_brk_10e_compliance_package.sql | 13 | 15 | **KEEP-PENDING** | 13 code reference(s) in src/ |
| `sba_form_payloads` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 12 | 11 | **KEEP-PENDING** | 12 code reference(s) in src/ |
| `sba_loans` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 6 | 6 | **KEEP-PENDING** | 6 code reference(s) in src/ |
| `sba_milestones` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `sba_package_run_items` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000013_sba_package_builder.sql | 13 | 13 | **KEEP-PENDING** | 13 code reference(s) in src/ |
| `sba_package_runs` | 0 | 0 | 0 | 0 | 0 | 0 | 20251218000013_sba_package_builder.sql | 7 | 7 | **KEEP-PENDING** | 7 code reference(s) in src/ |
| `sba_preflight_results` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 9 | 8 | **KEEP-PENDING** | 9 code reference(s) in src/ |
| `sba_rule_index` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000020_sba_knowledge_store.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `sba_sources` | 0 | 0 | 0 | 0 | 0 | 1 | 20251220000020_sba_knowledge_store.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `screen_artifacts` | 0 | 0 | 0 | 0 | 0 | 3 | 20251221000000_screen_artifacts.sql | 5 | 5 | **KEEP-PENDING** | 5 code reference(s) in src/ |
| `signed_documents` | 0 | 0 | 0 | 0 | 0 | 4 | 20260513_signed_documents.sql | 19 | 19 | **KEEP-PENDING** | 19 code reference(s) in src/ |
| `signing_requests` | 0 | 0 | 0 | 0 | 0 | 2 | 20260717050000_signing_requests_and_bank_fk_fix.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `storage_objects_cache` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `storage_scan_runs` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 4 | 4 | **KEEP-PENDING** | 4 code reference(s) in src/ |
| `structuring_recommendation_snapshots` | 0 | 0 | 0 | 0 | 0 | 2 | 20260506_structuring_recommendation_snapshots.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `third_party_orders` | 0 | 0 | 0 | 0 | 0 | 4 | 20260605_b_third_party_orders.sql | 10 | 10 | **KEEP-PENDING** | 10 code reference(s) in src/ |
| `third_party_vendors` | 0 | 0 | 0 | 0 | 0 | 4 | 20260605_b_third_party_orders.sql | 3 | 3 | **KEEP-PENDING** | 3 code reference(s) in src/ |
| `underwriting_launch_certifications` | 0 | 0 | 0 | 0 | 0 | 1 | 20260601_underwriting_launch_control.sql | 1 | 1 | **KEEP-PENDING** | 1 code reference(s) in src/ |
| `upload_idempotency_keys` | 0 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `virus_scan_cache` | 0 | 0 | 0 | 0 | 0 | 1 | 20260210000001_virus_scan_cache_and_sha256_index.sql | 2 | 2 | **KEEP-PENDING** | 2 code reference(s) in src/ |
| `bank_etran_credentials` | 0 | 0 | 0 | 0 | 2 | 1 | 20260605_c_etran_credentials.sql | 2 | 2 | **KEEP-STRUCTURAL** | 2 function reference |
| `bank_policy_chunks` | 0 | 0 | 0 | 0 | 1 | 1 | 20251219000014_policy_aware_underwriting.sql | 4 | 10 | **KEEP-STRUCTURAL** | 1 function reference |
| `borrower_applicants` | 0 | 0 | 0 | 0 | 1 | 0 | *(none found)* | 1 | 1 | **KEEP-STRUCTURAL** | 1 function reference |
| `borrower_document_requests` | 0 | 0 | 0 | 5 | 0 | 0 | 20251219000004_borrower_portal.sql | 28 | 28 | **KEEP-STRUCTURAL** | 5 view/matview dependency |
| `borrower_invites` | 0 | 0 | 0 | 4 | 0 | 0 | 20251219000004_borrower_portal.sql | 7 | 7 | **KEEP-STRUCTURAL** | 4 view/matview dependency |
| `borrower_messages` | 0 | 0 | 0 | 2 | 0 | 0 | 20251219000004_borrower_portal.sql | 3 | 3 | **KEEP-STRUCTURAL** | 2 view/matview dependency |
| `borrower_notifications` | 0 | 0 | 0 | 1 | 0 | 0 | *(none found)* | 4 | 4 | **KEEP-STRUCTURAL** | 1 view/matview dependency |
| `borrower_pack_learning_events` | 0 | 0 | 0 | 3 | 0 | 0 | 20251219000012_pack_learning_system.sql | 1 | 1 | **KEEP-STRUCTURAL** | 3 view/matview dependency |
| `borrower_pack_match_events` | 0 | 0 | 0 | 3 | 0 | 0 | 20251219000012_pack_learning_system.sql | 2 | 2 | **KEEP-STRUCTURAL** | 3 view/matview dependency |
| `borrower_portal_links` | 0 | 0 | 0 | 0 | 3 | 0 | 20251218000007_mega_step_13_14_15_outbound.sql | 33 | 33 | **KEEP-STRUCTURAL** | 3 function reference |
| `borrower_portal_sessions` | 0 | 0 | 0 | 3 | 0 | 0 | 20251219000004_borrower_portal.sql | 3 | 3 | **KEEP-STRUCTURAL** | 3 view/matview dependency |
| `borrower_request_campaigns` | 0 | 0 | 0 | 1 | 0 | 1 | 20260328_borrower_orchestration.sql | 22 | 22 | **KEEP-STRUCTURAL** | 1 view/matview dependency |
| `borrower_upload_events` | 0 | 0 | 0 | 3 | 0 | 0 | *(none found)* | 3 | 3 | **KEEP-STRUCTURAL** | 3 view/matview dependency |
| `borrower_upload_matches` | 0 | 0 | 0 | 3 | 0 | 0 | *(none found)* | 3 | 3 | **KEEP-STRUCTURAL** | 3 view/matview dependency |
| `borrower_uploads` | 0 | 0 | 0 | 3 | 0 | 0 | 20251219000004_borrower_portal.sql | 20 | 20 | **KEEP-STRUCTURAL** | 3 view/matview dependency |
| `buddy_observer_events` | 0 | 0 | 0 | 0 | 1 | 1 | 202601280001_buddy_observability.sql | 0 | 5 | **KEEP-STRUCTURAL** | 1 function reference |
| `buddy_research_http_cache` | 0 | 0 | 0 | 0 | 1 | 1 | 20260125999999_research_hardening.sql | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `buddy_research_plans` | 0 | 0 | 0 | 0 | 1 | 4 | 20260126100000_buddy_research_planner.sql | 9 | 9 | **KEEP-STRUCTURAL** | 1 function reference |
| `canonical_action_executions` | 0 | 0 | 0 | 1 | 0 | 1 | 20260328_canonical_action_executions.sql | 4 | 4 | **KEEP-STRUCTURAL** | 1 view/matview dependency |
| `contacts` | 0 | 0 | 0 | 0 | 2 | 4 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 2 function reference |
| `deal_assignment_events` | 0 | 0 | 0 | 3 | 0 | 0 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 3 view/matview dependency |
| `deal_condition_events` | 0 | 0 | 0 | 3 | 0 | 4 | 20251219000007_conditions_generator.sql | 4 | 4 | **KEEP-STRUCTURAL** | 3 view/matview dependency |
| `deal_context_snapshots` | 0 | 0 | 0 | 0 | 1 | 0 | *(none found)* | 5 | 5 | **KEEP-STRUCTURAL** | 1 function reference |
| `deal_files_legacy` | 0 | 0 | 0 | 1 | 0 | 0 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 view/matview dependency |
| `deal_interview_facts` | 0 | 0 | 0 | 2 | 0 | 4 | *(none found)* | 12 | 12 | **KEEP-STRUCTURAL** | 2 view/matview dependency |
| `deal_interview_sessions` | 0 | 0 | 0 | 2 | 1 | 4 | *(none found)* | 11 | 11 | **KEEP-STRUCTURAL** | 2 view/matview dependency; 1 function reference |
| `deal_interview_turns` | 0 | 0 | 0 | 1 | 0 | 4 | *(none found)* | 10 | 10 | **KEEP-STRUCTURAL** | 1 view/matview dependency |
| `deal_mitigants` | 0 | 0 | 0 | 3 | 0 | 4 | 20251219000008_deal_mitigants.sql | 9 | 9 | **KEEP-STRUCTURAL** | 3 view/matview dependency |
| `deal_participants` | 0 | 0 | 0 | 0 | 1 | 0 | 20251218000002_deal_participants.sql | 19 | 19 | **KEEP-STRUCTURAL** | 1 function reference |
| `deal_pipeline_runs` | 0 | 0 | 0 | 0 | 2 | 1 | 20251227000005_deal_pipeline_runs.sql | 13 | 13 | **KEEP-STRUCTURAL** | 2 function reference |
| `deal_reconciliation_findings` | 0 | 0 | 0 | 1 | 0 | 3 | 20260507160056_deal_reconciliation_findings.sql | 0 | 0 | **KEEP-STRUCTURAL** | 1 view/matview dependency |
| `deal_reminder_subscriptions` | 0 | 0 | 0 | 0 | 1 | 0 | 20251219000018_step15_reminders.sql | 21 | 25 | **KEEP-STRUCTURAL** | 1 function reference |
| `deal_timeline_events` | 0 | 0 | 0 | 2 | 2 | 4 | 20251220000010_deal_status_and_timeline.sql | 42 | 42 | **KEEP-STRUCTURAL** | 2 view/matview dependency; 2 function reference |
| `deal_underwriter_assignments` | 0 | 0 | 0 | 3 | 0 | 0 | *(none found)* | 1 | 1 | **KEEP-STRUCTURAL** | 3 view/matview dependency |
| `document_classifications` | 0 | 0 | 0 | 0 | 1 | 0 | 20251218000009_ocr_jobs_and_results.sql | 2 | 2 | **KEEP-STRUCTURAL** | 1 function reference |
| `email_messages` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `identity_users` | 0 | 0 | 0 | 0 | 1 | 4 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `ledger_account_balances` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `ledger_accounts` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `ledger_entries` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `ledger_lines` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `lender_invoices` | 0 | 0 | 0 | 0 | 1 | 1 | 20260709212825_brokerage_billing_lender_invoices.sql | 8 | 8 | **KEEP-STRUCTURAL** | 1 function reference |
| `marketplace_claims` | 0 | 0 | 0 | 0 | 1 | 1 | 20260717050000_crm_intelligence_revenue_command_center.sql | 12 | 15 | **KEEP-STRUCTURAL** | 1 function reference |
| `marketplace_listings` | 0 | 0 | 0 | 0 | 1 | 1 | 20260429_sealing_and_listings.sql | 22 | 25 | **KEEP-STRUCTURAL** | 1 function reference |
| `ocr_shadow_comparisons` | 0 | 0 | 0 | 1 | 0 | 2 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 view/matview dependency |
| `peis_intelligence_missions` | 0 | 0 | 0 | 0 | 1 | 2 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `peis_object_deltas` | 0 | 0 | 0 | 0 | 2 | 2 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 2 function reference |
| `sba_sop_chunks` | 0 | 0 | 0 | 0 | 1 | 0 | 20251227000013_sba_god_mode_stores.sql | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `third_brain_events` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `underwrite_artifacts` | 0 | 0 | 0 | 0 | 2 | 1 | *(none found)* | 3 | 3 | **KEEP-STRUCTURAL** | 2 function reference |
| `uploads` | 0 | 0 | 0 | 0 | 2 | 0 | 20251228000003_borrower_portal_e2e.sql | 1 | 1 | **KEEP-STRUCTURAL** | 2 function reference |
| `user_banks` | 0 | 0 | 0 | 0 | 1 | 0 | *(none found)* | 0 | 0 | **KEEP-STRUCTURAL** | 1 function reference |
| `user_usage` | 0 | 0 | 0 | 0 | 1 | 2 | 20251221000002_user_usage_limits.sql | 4 | 4 | **KEEP-STRUCTURAL** | 1 function reference |
| `aegis_vendor_changelog_state` | 5 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 5 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `app_users` | 2 | 0 | 0 | 0 | 0 | 0 | 20251228999999_create_app_users_and_platform_admins.sql | 1 | 1 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 2 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `bank_documents` | 1 | 0 | 0 | 0 | 0 | 1 | 20260202000000_bank_documents.sql | 5 | 5 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `bank_loan_product_types` | 13 | 0 | 0 | 0 | 0 | 2 | 20260204000002_create_bank_loan_product_types.sql | 2 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 13 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `bank_user_memberships` | 2 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 1 | 1 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 2 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `borrower_owners` | 18 | 0 | 0 | 0 | 0 | 1 | 20260127000002_borrower_owners_and_naics.sql | 5 | 5 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 18 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `borrower_pack_templates` | 5 | 0 | 0 | 2 | 0 | 0 | 20251219000013_pack_templates.sql | 5 | 5 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 5 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `borrower_reminder_rules` | 2 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 0 | 0 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 2 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `brokerage_borrower_message_templates` | 10 | 0 | 0 | 0 | 0 | 1 | 20260626_brk_10o_borrower_comms.sql | 1 | 1 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 10 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `brokerage_fee_config` | 1 | 0 | 0 | 0 | 0 | 1 | 20260621_brk_10e_compliance_package.sql | 2 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `brokerage_lender_message_templates` | 7 | 0 | 0 | 0 | 0 | 1 | 20260627_brk_10p_lender_comms.sql | 1 | 1 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 7 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_ai_use_cases` | 8 | 0 | 0 | 0 | 0 | 2 | 20260127000000_ai_governance_use_cases.sql | 2 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 8 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_covenant_packages` | 2 | 0 | 0 | 0 | 0 | 2 | 20260515_covenant_packages.sql | 4 | 4 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 2 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_industry_benchmarks` | 25 | 0 | 0 | 0 | 0 | 2 | 20260516_borrower_health_reports.sql | 3 | 3 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 25 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_ledger_events` | 201 | 0 | 0 | 1 | 0 | 1 | 20260129000000_buddy_ledger_events.sql | 9 | 12 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 201 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_regulated_industries` | 15 | 0 | 0 | 0 | 0 | 1 | 20260126100000_buddy_research_planner.sql | 0 | 0 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 15 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_committee_task_reviews` | 12 | 0 | 0 | 0 | 0 | 2 | 20260604_committee_evidence_review_actions.sql | 1 | 1 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 12 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_committee_tasks` | 9 | 0 | 0 | 0 | 0 | 2 | 20260603_bie_source_snapshot_ledger_and_committee_tasks.sql | 12 | 12 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 9 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_evidence` | 42 | 0 | 0 | 0 | 0 | 4 | 20260602_phase_66a_multi_agent_control_plane.sql | 9 | 9 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 42 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_facts` | 261 | 0 | 0 | 0 | 1 | 4 | 20260126000000_buddy_research_engine.sql | 10 | 10 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 261 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_inferences` | 3 | 0 | 0 | 0 | 1 | 4 | 20260126000000_buddy_research_engine.sql | 9 | 9 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 3 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_missions` | 7 | 0 | 0 | 2 | 1 | 4 | 20260126000000_buddy_research_engine.sql | 44 | 44 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 7 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_narratives` | 6 | 0 | 0 | 0 | 0 | 4 | 20260126000000_buddy_research_engine.sql | 12 | 12 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 6 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_quality_gates` | 7 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 10 | 10 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 7 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_source_artifacts` | 2 | 0 | 0 | 0 | 0 | 2 | 20260604_research_source_artifacts.sql | 5 | 5 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 2 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_source_snapshots` | 3 | 0 | 0 | 0 | 0 | 2 | 20260603_bie_source_snapshot_ledger_and_committee_tasks.sql | 9 | 9 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 3 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `buddy_research_sources` | 21 | 0 | 0 | 0 | 1 | 4 | 20260126000000_buddy_research_engine.sql | 7 | 7 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 21 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `canonical_memo_narratives` | 8 | 0 | 0 | 0 | 0 | 2 | 20260206174559_create_canonical_memo_narratives.sql | 17 | 17 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 8 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `classic_spread_review_actions` | 9 | 0 | 0 | 0 | 0 | 0 | 20260615_classic_spread_review_actions.sql | 1 | 1 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 9 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `condition_match_rules` | 8 | 0 | 0 | 0 | 0 | 0 | *(none found)* | 2 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 8 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `credit_memo_snapshots` | 1 | 0 | 0 | 0 | 2 | 2 | 20260505_committee_exception_workflow.sql | 14 | 14 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_builder_sections` | 2 | 0 | 0 | 0 | 0 | 1 | 20260320_deal_builder.sql | 31 | 31 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 2 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_collateral_items` | 3 | 0 | 0 | 0 | 0 | 1 | 20260320_deal_builder.sql | 22 | 22 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 3 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_doc_chunks` | 5 | 0 | 0 | 0 | 1 | 0 | 20260711_backfill_intake_slot_tables.sql | 1 | 7 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 5 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_eta_note_templates` | 8 | 0 | 0 | 0 | 0 | 4 | 20251220000021_status_playbook_templates_and_doc_receipts.sql | 2 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 8 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_loan_requests` | 35 | 0 | 0 | 0 | 0 | 1 | 20251220000014_loan_requests.sql | 60 | 60 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 35 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_management_profiles` | 3 | 0 | 0 | 0 | 0 | 1 | 20260610000000_memo_input_completeness.sql | 12 | 13 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 3 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_memo_overrides` | 1 | 0 | 0 | 1 | 0 | 1 | 20260501_deal_memo_overrides.sql | 20 | 44 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_ownership_entities` | 1 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 7 | 7 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_portal_status` | 141 | 0 | 0 | 0 | 0 | 1 | 20251220000002_borrower_guided_upload_mode.sql | 4 | 4 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 141 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_pricing_inputs` | 4 | 0 | 0 | 0 | 0 | 2 | 20260117001000_bank_grade_pricing.sql | 18 | 18 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 4 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_pricing_quotes` | 1 | 0 | 0 | 0 | 0 | 2 | 20260117001000_bank_grade_pricing.sql | 14 | 14 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_proceeds_items` | 1 | 0 | 0 | 0 | 0 | 1 | 20260320_deal_builder.sql | 8 | 8 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_reconciliation_results` | 7 | 0 | 0 | 1 | 0 | 4 | 20260430000000_deal_reconciliation_results.sql | 7 | 7 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 7 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_risk_pricing_model` | 1 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 9 | 9 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_stage_playbook` | 8 | 0 | 0 | 0 | 0 | 1 | 20251220000021_status_playbook_templates_and_doc_receipts.sql | 1 | 1 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 8 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_structural_pricing` | 7 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 24 | 24 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 7 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_transcript_uploads` | 3 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 4 | 4 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 3 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `deal_upload_links` | 1 | 0 | 0 | 0 | 0 | 0 | 20251219000020_step15_upload_links_and_audit.sql | 8 | 8 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `decision_attestations` | 1 | 0 | 0 | 0 | 0 | 0 | 20251228000008_decision_attestations.sql | 10 | 10 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `decision_snapshots` | 1 | 0 | 0 | 0 | 0 | 0 | 20251229000003_decision_os_safe.sql | 41 | 41 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `doc_extraction_cache` | 46 | 0 | 0 | 0 | 0 | 1 | 20260210000000_doc_extraction_cache.sql | 2 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 46 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `doc_gatekeeper_cache` | 55 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 2 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 55 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `doc_intel_results` | 178 | 0 | 0 | 0 | 0 | 4 | 20251220000004_buddy_credit_discovery_ai_everywhere.sql | 17 | 17 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 178 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `draft_borrower_requests` | 1 | 0 | 0 | 1 | 0 | 1 | 20251218000003_draft_borrower_requests.sql | 7 | 7 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `fdd_filings` | 5794 | 0 | 0 | 0 | 0 | 2 | 20260422_franchise_intelligence_foundation.sql | 0 | 11 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 5794 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `fdd_item19_facts` | 26927 | 0 | 0 | 0 | 0 | 2 | 20260422_franchise_intelligence_foundation.sql | 3 | 5 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 26927 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `financial_snapshot_decisions` | 23 | 0 | 0 | 0 | 0 | 1 | 20260116150000_financial_snapshots_v1.sql | 15 | 15 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 23 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `financial_snapshots_v2` | 1 | 0 | 0 | 0 | 0 | 1 | 20260326_financial_snapshot_validation.sql | 11 | 11 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `financial_statement_period_reviews` | 1 | 0 | 0 | 0 | 0 | 0 | 20260527_financial_period_reviews.sql | 9 | 9 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `franchise_brands` | 8433 | 0 | 0 | 0 | 1 | 2 | 20260422_franchise_intelligence_foundation.sql | 15 | 40 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 8433 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `franchise_sba_directory_snapshots` | 32433 | 0 | 0 | 0 | 0 | 2 | 20260422_franchise_intelligence_foundation.sql | 0 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 32433 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `legal_documents` | 5 | 0 | 0 | 0 | 0 | 1 | 20260621_brk_10e_compliance_package.sql | 3 | 3 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 5 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `loan_doc_templates` | 4 | 0 | 0 | 0 | 0 | 1 | 20260326_closing_package_foundation.sql | 2 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 4 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `loan_product_types` | 29 | 0 | 0 | 0 | 0 | 2 | 20260204000003_create_loan_product_types.sql | 3 | 3 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 29 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `marketplace_rate_card` | 44 | 0 | 0 | 0 | 0 | 1 | 20260429_sealing_and_listings.sql | 1 | 1 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 44 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `metric_definitions` | 7 | 0 | 0 | 0 | 0 | 1 | 20260213000002_metric_definitions.sql | 2 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 7 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `metric_registry_entries` | 7 | 0 | 0 | 0 | 0 | 1 | 20260213000003_metric_registry_versions.sql | 3 | 3 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 7 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `metric_registry_versions` | 1 | 0 | 0 | 0 | 0 | 1 | 20260213000003_metric_registry_versions.sql | 9 | 9 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `owner_requirements` | 1 | 0 | 0 | 0 | 0 | 4 | 20251220000004_buddy_credit_discovery_ai_everywhere.sql | 2 | 2 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `ownership_edges` | 1 | 0 | 0 | 0 | 0 | 4 | 20251220000004_buddy_credit_discovery_ai_everywhere.sql | 3 | 3 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `platform_admins` | 1 | 0 | 0 | 0 | 1 | 0 | 20251228999999_create_app_users_and_platform_admins.sql | 0 | 0 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `platform_capabilities` | 5 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 5 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `pricing_decisions` | 2 | 0 | 0 | 0 | 0 | 2 | 20260206200000_pricing_decision_system.sql | 12 | 12 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 2 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `pricing_scenarios` | 6 | 0 | 0 | 0 | 0 | 2 | 20260206200000_pricing_decision_system.sql | 6 | 6 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 6 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `pricing_terms` | 2 | 0 | 0 | 0 | 0 | 2 | 20260206200000_pricing_decision_system.sql | 1 | 1 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 2 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `pulse_active_truths` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_anticipated_needs` | 0 | 0 | 0 | 0 | 1 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_capture_sessions` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_commitments` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_context_products` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_contingency_nodes` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_contingency_trees` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_crm_contacts` | 0 | 0 | 0 | 0 | 0 | 4 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_doctrine_overlays` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_doctrine_promotions` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_durable_memories` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_episode_traces` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_episodes` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_executive_memory` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_experience_events` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_learning_artifacts` | 0 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_mission_contingencies` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_mission_entities` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_mission_signals` | 0 | 0 | 0 | 0 | 1 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_mission_summaries` | 0 | 0 | 0 | 0 | 1 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_mission_watchpoints` | 0 | 0 | 0 | 0 | 1 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_missions` | 0 | 0 | 0 | 0 | 1 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_preparation_artifacts` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_projects` | 1 | 0 | 0 | 0 | 0 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_reach_calibration_events` | 0 | 0 | 0 | 1 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_run_events` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_runs` | 0 | 0 | 0 | 0 | 0 | 3 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_skills` | 0 | 0 | 0 | 0 | 1 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_surface_calibration_candidates` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_surface_calibration_impact_windows` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_surface_calibration_versions` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_surface_replay_records` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_task_branches` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_task_edges` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_task_graphs` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_task_nodes` | 0 | 0 | 0 | 0 | 0 | 2 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `pulse_voice_turns` | 0 | 0 | 0 | 0 | 2 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | pulse_* — non-goal, Omega Prime advisory-boundary decision, default KEEP per Matt (2026-07-29) |
| `rate_index_snapshots` | 2 | 0 | 0 | 0 | 0 | 2 | 20260117001000_bank_grade_pricing.sql | 3 | 3 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 2 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `tasks` | 14 | 0 | 0 | 1 | 0 | 1 | *(none found)* | 0 | 0 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 14 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `underwriting_launch_snapshots` | 1 | 0 | 0 | 0 | 0 | 1 | 20260601_underwriting_launch_control.sql | 4 | 4 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |
| `underwriting_workspaces` | 1 | 0 | 0 | 0 | 0 | 1 | 20260601_underwriting_launch_control.sql | 6 | 6 | **DECIDE-MATT** | n_live_tup=0 is STALE — table actually has 1 live row(s). NOT empty. Excluded from DROP consideration entirely; investigate write path before any action. |

## Matt's review (required before any C2 drop batch)

Per spec: **Matt reviews this doc and marks approvals via a review commit — this doc, once approved, is the sole authority for C2.** Suggested review flow:

1. Skim the 82 `DROP` rows. For any you're not comfortable with, change its classification to `DECIDE-MATT` or `KEEP-PENDING` (with a one-line reason) directly in this file, in your review commit.
2. Confirm the `pulse_*` default-KEEP stance still holds (already confirmed 2026-07-29 — no change expected).
3. Anything you want re-checked against a specific named future spec before dropping, note it inline — `KEEP-PENDING` entries with a bare code reference and no spec name are candidates for you to either confirm-drop or attach a spec citation to.
4. Once approved, C2 (PR 4+) will batch the approved `DROP` rows into groups of ≤25, `DROP TABLE ... RESTRICT` only, each batch citing the line numbers here that authorize it, gated on your sign-off per batch.

### ✅ Approved 2026-07-29 — all 82 `DROP` rows, all 4 batches

Matt reviewed the batch breakdown (below) and approved all four batches for C2, with no reclassifications. Two names were explicitly flagged for a second look before approval — `tenants` and `user_identities` (lines 158, 161) — both sound structurally foundational despite showing zero FK/view/function/code references and zero real rows across every check in this doc; Matt confirmed drop anyway. This section is the review commit required by the spec — **this doc is now the sole authority for C2**, per the rule above.

| C2 batch | Doc line range | Tables | Status |
|---|---|---:|---|
| Batch 1 | 83–107 | 25 | ✅ Approved |
| Batch 2 | 108–132 | 25 | ✅ Approved |
| Batch 3 | 133–157 | 25 | ✅ Approved |
| Batch 4 | 158–164 | 7 | ✅ Approved (incl. `tenants`, `user_identities` — flagged, confirmed) |

Per spec sequencing, C2 still authors and applies **one batch at a time** — Batch 2's migration is not authored until Matt confirms Batch 1 applied clean in production, and so on through Batch 4. Approval-in-advance covers all four; the apply-and-confirm gate between batches still applies.
