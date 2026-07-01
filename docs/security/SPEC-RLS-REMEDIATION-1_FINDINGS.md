# SPEC-RLS-REMEDIATION-1 — §0 Verification Findings & Hand-off

**Deliverable:** `supabase/migrations/20260701_rls_remediation_anon_reachable_tables.sql`
**Status:** migration written + validated; **NOT applied.** Production security DDL is Matt's action.
**Author of this pass:** Claude Code (spec = SPEC-RLS-REMEDIATION-1).

---

## TL;DR

- **§0.2 GATE PASSED.** No `anon`/`authenticated` Supabase client reads or writes **any** of the 77
  tables. Every access path goes through `supabaseAdmin()` (service_role), which bypasses RLS. Enabling RLS
  is therefore transparent to the application — **R1 (the one migration-breaking risk) does not fire.**
- **R2 (`borrower_session_tokens`) resolved:** the borrower-portal auth helper reads/writes it exclusively via
  `supabaseAdmin()` (service_role). Pattern A is safe for it; the `authenticated` policy is dormant.
- **R3 resolved:** `service_role` has `rolbypassrls=true`; the migration also adds an explicit service_role
  bypass policy per table (mirrors Phase 84). Workers/finengine scripts (all service_role) keep working.
- The migration is **idempotent, single-transaction, column-introspecting**, and validated to compile/run.

## ⚠️ Blocking caveat for Matt (read before applying)

**The Supabase MCP account available to this session only exposes the "Pulse OS" project
(`jqxnmuvqeduovnoajkru`), NOT the Buddy production DB (`sglhiuizgugbnzkymwnk`, per `.env`
`SUPABASE_PROJECT_REF`).** Consequently the **live-DB** portions of §0 could **not** be executed against Buddy:

| §0 step | Verifiable here? | Notes |
|---|---|---|
| §0.1 anon key enabled | ✅ yes | anon (legacy) + publishable key both `disabled:false`. |
| §0.1 live anon/auth DML grants on the 77 | ❌ no | Must be re-run on Buddy. The embedded invariant query returned 0 rows on Pulse only because 76/77 tables don't exist there. |
| §0.2 anon/auth client read paths (GATE) | ✅ yes (codebase) | Pure code grep — see below. PASSED. |
| §0.3 live Pattern A/B defs + `can_access_deal` | ⚠️ partial | Read from tracked migrations, not live. `can_access_deal` is **absent from the repo** and unverifiable — see "Pattern B decision". |
| §0.4 service_role retains access | ✅ yes | `rolbypassrls=true` (platform default, same on Buddy) + explicit bypass policy. |
| Post-apply invariant / access smoke | ❌ no | **Matt must run these on Buddy** (queries embedded at the bottom of the migration). |

**Action for Matt:** before/after applying, run the invariant + policy-count queries (bottom of the migration)
against `sglhiuizgugbnzkymwnk`. Confirm the 5 Tier-C.3 join columns (below) before enabling their scoped
policies.

---

## §0.2 — the GATE (codebase evidence)

Client factories:
- **anon / RLS-subject:** `src/lib/supabase/browser.ts` (`supabase`), `serverAuthed.ts` (`getAuthedSupabase`),
  `rls.ts` (`getSupabaseAnon`).
- **service_role / RLS-bypass:** `src/lib/supabase/admin.ts` (`supabaseAdmin`).

Findings across the 77 tables:
- **418** `.from(<77-table>)` call sites across **180** files.
- **157** files use `supabaseAdmin` directly; **21** are lib helpers that take an injected `SupabaseClient`
  param (callers are admin routes); **2** use the server client (service-first). **0** import an anon-path
  client; **0** are `"use client"` components.
- The only files constructing an anon-path client are **borrower-interview session routes**, and **none** of
  them touch any of the 77 tables or their writer helpers.
- `borrower_session_tokens` (highest-priority, R2): all reads/writes/updates in
  `src/lib/brokerage/sessionToken.ts` use `supabaseAdmin()`. The borrower portal authenticates by hashing the
  HTTP-only cookie and looking it up via **service_role** — RLS is transparent.

**Conclusion:** enabling RLS breaks no code path. GATE passes.

---

## Pattern B decision (documented deviation — needs Matt's nod)

The spec's Pattern B uses a `can_access_deal(deal_id)` helper. That helper **does not exist anywhere in the
repo** (0 matches under `supabase/`) and could not be verified live. The repo's **own proven** deal-scoped
pattern (Phase 84, `20260418_phase_84_rls_tenant_wall_batch_a.sql`) is an inline
`EXISTS (SELECT 1 FROM deals d WHERE d.id = <t>.deal_id AND d.bank_id = jwt.bank_id)` subquery.

**Chosen:** the inline `deals` subquery (semantically identical tenant scope, self-contained, no dependency on
an unverifiable function; also what the spec itself prescribes for Tier-C deal-derived tables). `::text` casts
on both sides tolerate uuid-or-text `deal_id`. If Matt confirms `can_access_deal()` exists live and prefers
it, the Pattern B body is a one-line swap.

---

## Tier assignments (as implemented)

- **Tier A / B are applied by DETECTED key column, not a hard-coded per-table pattern.** ~40 of the 77 tables
  are not in the tracked repo migrations (their DDL lives only on the live DB), so hard-coding a column would
  risk aborting the whole migration on one surprise. Every table first gets `ENABLE RLS` + service_role
  bypass (which alone closes the anon/auth hole); then a tenant policy is attached: `bank_id` → Pattern A,
  else `deal_id` → Pattern B, else NOTICE + skip (still secured service_role-only). For the in-repo tables,
  detected columns match the spec's tiering exactly.
- **Tier C.1 global-ref** (`loan_product_types, pricing_terms, buddy_industry_benchmarks,
  platform_capabilities, buddy_ai_use_cases`): RLS + service_role bypass + `authenticated SELECT USING(true)`;
  writes service_role-only.
- **Tier C.2 internal** (`buddy_eval_runs, buddy_eval_scores, rate_limit_counters, peis_mission_objects,
  pulse_projects, risk_factors`): RLS + service_role-only (anon/auth denied).
- **Tier C.3 deal-derived, no direct key** (5 tables): RLS + service_role-only NOW (hole closed). Scoped
  `authenticated` policy **deferred** (not guessed). Traced join paths to confirm live before enabling:
  - `borrower_owner_attestations` → `borrower_id` → `borrowers.(bank_id?)` **[confirm borrowers tenant col]**
  - `buddy_covenant_overrides` → `package_id` → `buddy_covenant_packages.deal_id` → `deals.bank_id`
  - `deal_policy_exception_actions` → `exception_id` → `deal_policy_exceptions.deal_id` → `deals.bank_id`
  - `deal_watchlist_reasons` → `watchlist_case_id` → `deal_watchlist_cases.(bank_id)` (Tier A parent)
  - `memo_sections` → `memo_run_id` → `memo_runs.deal_id` → `deals.bank_id` (`memo_runs` already RLS'd in Phase 84)
- **`zz_finengine_golden_run_backup_20260627`**: unreferenced anywhere in the repo → `DROP TABLE IF EXISTS`.

## Validation performed

- Full script compiled + executed inside a **rolled-back** transaction on the reachable DB (no persistent
  change; `peis_mission_objects`, the only present table, received exactly its intended service_role-only
  policy). Zero leftover policies confirmed afterward.
- Pattern A `CREATE POLICY` compiled OK against a real `bank_id` table. Pattern B mirrors the proven Phase-84
  subquery verbatim (it references `deals.bank_id`, which exists on Buddy; it does not on Pulse, which is why
  Pattern B can only be structurally — not executionally — validated here).

## Exceptions / scope deviations (per house rule: surface, don't absorb)

1. **Pattern B uses the inline `deals` subquery, not `can_access_deal()`** — because that helper is absent
   from the repo and unverifiable. Documented above; one-line swap if Matt confirms it live.
2. **Tier A/B pattern is applied by introspected key column** rather than statically per the spec's tier
   lists — a robustness measure given ~40 tables' DDL isn't in the repo. Produces the spec's intended A/B
   assignment for every table that has the expected key.
3. **Tier C.3 scoped `authenticated` policies are deferred** (service_role-only closes the hole now) rather
   than guessed, honoring the spec's "do NOT guess an isolation column."
4. **Live-DB §0.1 grants + post-apply invariant/smoke could not be run** (MCP lacks the Buddy project).
   Matt must run them.

## Follow-ons (out of scope here, per spec)

- Anon grant revocation (grant-hygiene) — intentionally not done; RLS is the surgical fix.
- Enabling the Tier-C.3 scoped `authenticated` policies once join columns are confirmed live.
- Minting a `bank_id` JWT claim so the (currently dormant) `authenticated` tenant policies become active
  (tracked since Phase 84.1).
