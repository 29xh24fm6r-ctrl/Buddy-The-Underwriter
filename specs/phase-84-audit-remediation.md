# Phase 84 — System Audit Remediation (v2 — Reconciled)

**Status:** Draft for Claude Code / Antigravity execution
**Authored:** 2026-04-17 (Claude Opus 4.7 audit, v2 reconciled against repo state)
**Supersedes:** v1 of this spec (commit `2f81a03c`) — see changelog at end
**Scope:** Reduced from 37 findings / 10 tickets to 30 findings / 10 tickets after reconciliation
**Guardrail:** Every ticket starts with pre-work that checks whether the fix is already in repo. If yes, the ticket converts to an audit ticket, not a build ticket.

---

## Why this was revised

v1 of this spec asserted several things that turned out to be already fixed in `main`. Specifically:

| v1 claim | Reality in repo |
|---|---|
| "Checklist stuck at `received`, no propagation to `satisfied`" | `create_checklist_match()` DB function flips `missing → received` with monotonic upgrade. `recomputeDealDocumentState.ts` (Phase 66) writes `satisfied/received/missing` into the canonical `deal_document_items` table. `deal_document_snapshots` shows 71–100% readiness on 7 deals. The v1 audit queried the wrong table (`deal_checklist_items`) and missed this. |
| "Omega 100% failing live" | Pulse-backed RPC calls do fail with `Method not found`. But `OmegaAdvisoryAdapter` (Phase 65A) already checks `OMEGA_MCP_ENABLED === "1"` correctly, and the `/api/deals/[dealId]/state` route has a working `ai_risk_runs` fallback via `synthesizeAdvisoryFromRisk()`. The user-facing Omega panel has a real fallback path. The Phase 79 `underwrite/state` route is the narrower broken path. |
| "Observer timeout 504s" | `/api/ops/observer/tick` already has `maxDuration=60`. The observer issue is dedup/cooldown, not timeout budget. |
| "Delete `runRecord.ts` is a viable Option B for T-04" | Wrong. The `agent_workflow_runs` view (Phase 72C) unions `deal_extraction_runs` with a `'document_extraction'` workflow code. Deleting the run ledger table would break the view. Option B is explicitly rejected in v2. |
| "Roadmap stuck on Phase 53A" | v1 didn't verify current roadmap content first — tickets should reconcile against whatever state exists. |

**The lesson:** v1 was an audit written before verifying whether the repo had already shipped fixes. v2 verifies first, then prescribes only what is still actually broken.

---

## What is still actually broken (the evidence base for v2)

All of the following were verified as of 2026-04-17 against `origin/main` and the production database:

1. **82 public tables have RLS disabled** — 129 ERROR-level advisor findings. Cross-tenant tables including `deal_financial_facts`, `deal_spreads`, `canonical_memo_narratives`, `document_artifacts`, `deal_truth_events`, `deal_monitoring_*`, `deal_workout_*`. Unchanged since v1.

2. **Document classifier 100% failing** — 44/44 `DOC_GATEKEEPER_CLASSIFY_FAILED` events in 7 days carry `review_reason_code: NO_OCR_OR_IMAGE` and `reasons: ["Gemini classifier returned null on text path"]`. Every document gets `doc_type: UNKNOWN`. This is real and unchanged.

3. **Observer noise** — 7,028 `NO_SPREADS_RENDERED` critical events in 48 hours, all with `observer_decision: job_marked_dead` for the same stale jobs. Actual spreads health is fine (14/14 jobs SUCCEEDED, 34 spread_runs). Dedup/cooldown missing. Unchanged.

4. **`deal_extraction_runs` empty** — 1,366 facts via 10 distinct extractor paths, 0 extraction runs logged. `runRecord.ts` exports are not re-exported from `index.ts` and no extractor call site invokes them. Unchanged. Phase 72C cost-promotion work assumed this table was being populated.

5. **Omega Pulse RPC 100% fails** — 43/43 `omega.invoked` events pair with 43/43 `omega.failed`. `omega_rpc_error: Method not found`. **But** the `/api/deals/[dealId]/state` fallback absorbs this because `synthesizeAdvisoryFromRisk(ai_risk_runs.result_json)` renders the panel. The Phase 79 `/api/deals/[dealId]/underwrite/state` path does NOT have an equivalent fallback — its `omegaAdvisory` field is always null. Narrowed from "everywhere" to "the underwrite/state path specifically."

6. **Four duplicate `Ellmann & Elmann Part 2` deals** from 2026-04-15 — two have facts, two are empty. No idempotency guard on `POST /api/deals/create`. Unchanged.

7. **ChatGPT Fix 11–15 test deals in production** — no `is_test` flag. Unchanged.

8. **Governance tables untested** — `deal_decisions` (0), `agent_approval_events` (0), `canonical_action_executions` (0), `draft_borrower_requests` (0), `agent_skill_evolutions` (0) all empty. These are "infrastructure shipped but never exercised live" — which is the narrower real issue.

9. **`.env.example` stale** — no `OMEGA_MCP_*`, no `CLERK_JWT_KEY`, still has `OPENAI_REALTIME_*`, `USE_GEMINI_OCR=false` default. Unchanged.

10. **Roadmap last-updated marker out of date** — but the actual content past Phase 53A still needs reconciliation, not a blind rewrite.

11. **Samaritus deal (`ffcc9733-...`) deleted from prod** — not blocking any system; out of scope for this phase.

12. **336 dead-lettered outbox events (HTTP 401)** — pre-telemetry-fix artifacts; out of scope for this phase.

---

## What v1 got right and v2 preserves

- Wave structure (dependency order)
- T-02 classifier/OCR diagnosis flow
- T-04 wiring `gemini_primary_v1` through `runRecord.ts`
- T-06 idempotency guard on deal creation
- T-08 governance smoke test
- T-10 repo hygiene
- Execution protocol (pre-work SQL, AAR in `docs/archive/phase-84/`, phantom-commit mitigation)

---

## Ticket delta from v1

| v1 Ticket | v2 Ticket | Delta |
|---|---|---|
| T-01 RLS, 62 tables one migration | **T-01 RLS Batch A** (14 highest-risk tables) | Split into staged batches |
| — | **T-01-B RLS Batch B** (deferred to 84.1) | Pricing/workout/monitoring tables |
| T-02 Classifier OCR | **T-02 Classifier OCR** | Unchanged — diagnosis flow was correct |
| T-03 Observer dedup | **T-03 Observer dedup** | Removed timeout claim (already fixed), kept dedup |
| T-04 `runRecord` wire (Option A or B) | **T-04 `runRecord` wire** | Removed "Option B: delete" — would break `agent_workflow_runs` view |
| T-05 Add checklist promotion | **T-05 Audit checklist taxonomy split** (rewritten) | Propagation exists; investigate why legacy table diverges from canonical |
| T-06 Idempotency | **T-06 Idempotency** | Unchanged |
| T-07 Omega full rewrite | **T-07 Narrow Omega: add fallback to underwrite/state** | Preserves existing fallback, targets only the broken path |
| T-08 Governance smoke | **T-08 Governance smoke** | Unchanged |
| T-09 Roadmap + env | **T-09 Roadmap reconcile + env** | Phrased as reconcile-first, not rewrite-blind |
| T-10 Hygiene | **T-10 Hygiene** | Unchanged |

v1 T-01 is split into A (ship now) and B (84.1 follow-up). T-05 and T-07 are materially rewritten.

---

## Wave structure (v2)

| Wave | Goal | Tickets | Gate |
|---|---|---|---|
| 0 | Safety fence — staged RLS | T-01 | Batch A migration passes smoke test on at least one production deal |
| 1 | Stop the bleeding | T-02, T-03 | 10 successful classifications logged in 24h; critical event count drops below 200/24h |
| 2 | Close the truth loop | T-04, T-05, T-06 | At least one new `deal_extraction_runs` row; legacy vs canonical checklist discrepancy either reconciled or explained |
| 3 | Restore advisory + governance | T-07, T-08 | `underwrite/state` returns non-null `omegaAdvisory` at least once; 1+ row in each governance table |
| 4 | Housekeeping | T-09, T-10 | Roadmap + env reconciled against live repo state, test data flagged |

---

# Wave 0 — Safety fence

## T-01 — Staged RLS migration (Batch A)

**Finding reference:** 82 public tables with RLS disabled. GLBA defense-in-depth requirement.

**Why staged:** v1 proposed enabling RLS on 62 tables in one migration. The feedback from repo reconciliation is that this carries too much blast radius for a single migration:
- Assumes `request.jwt.claims->>'bank_id'` is reliably populated (not yet verified)
- Adds both `authenticated` and `service_role` policies simultaneously
- Covers admin/monitoring/workout paths that may have custom access patterns

v2 splits into two batches:

**Batch A (this ticket):** 14 highest-risk tables that carry raw extracted facts, memo content, and document bytes. These are the clear GLBA exposure surface.

**Batch B (Phase 84.1):** pricing, monitoring, renewal, workout, annual review tables. These carry meaningful data but are one step removed from the core fact/memo path, and need individual access-pattern audit before RLS lands.

### Batch A — Tables

```
deal_financial_facts            -- canonical fact store
deal_spreads                    -- computed spread output
canonical_memo_narratives       -- memo content
credit_memo_drafts              -- draft memos
credit_memo_snapshots           -- frozen memo state
credit_memo_citations           -- memo evidence trail
document_artifacts              -- raw document references
document_ocr_words              -- raw OCR content (PII risk)
document_ocr_page_map           -- raw OCR page structure (PII risk)
deal_truth_events               -- append-only audit trail
deal_upload_sessions            -- upload metadata
deal_upload_session_files       -- the 1 ERROR sensitive_columns_exposed row
memo_runs                       -- memo generation runs
risk_runs                       -- risk generation runs
```

### Pre-work (Antigravity MUST run first)

**Step 1 — Confirm RLS is still disabled on Batch A:**
```sql
SELECT 
  c.relname,
  c.relrowsecurity AS rls_enabled,
  COUNT(p.policyname) AS policy_count
FROM pg_class c
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE c.relname IN (
  'deal_financial_facts','deal_spreads','canonical_memo_narratives',
  'credit_memo_drafts','credit_memo_snapshots','credit_memo_citations',
  'document_artifacts','document_ocr_words','document_ocr_page_map',
  'deal_truth_events','deal_upload_sessions','deal_upload_session_files',
  'memo_runs','risk_runs'
)
AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
```

Expected: 14 rows, all with `rls_enabled=false, policy_count=0`. Any row showing RLS already enabled → remove from scope.

**Step 2 — Verify caller JWT claim contains `bank_id`:**
```sql
-- Run from the authenticated role via Supabase SQL editor or a test endpoint:
SELECT current_setting('request.jwt.claims', true)::jsonb->>'bank_id' AS jwt_bank_id;
```
If this returns null for a real authenticated session, the migration's `authenticated` policy will never match — service-role will still work, but the "defense in depth" benefit won't materialize. If null, switch the `authenticated` policy to a function that also checks `auth.uid()` against a `bank_users` mapping.

**Step 3 — Identify any non-service-role callers:**
```bash
# In the repo root:
grep -rn "createServerClient\|createBrowserClient" src/app/api/ | grep -v node_modules | head -20
```
Any API route using `createServerClient()` or `createBrowserClient()` (i.e. NOT `supabaseAdmin()`) will be subject to the new policies. Confirm there are no unexpected hits on Batch A tables.

### Implementation

Create `supabase/migrations/20260418_phase_84_rls_tenant_wall_batch_a.sql`:

```sql
-- Phase 84 T-01 Batch A — Tenant isolation wall (highest-risk tables only)
-- 
-- Enables RLS on 14 tables carrying raw facts, memo content, and OCR bytes.
-- Service-role bypasses policies (this is what supabaseAdmin() uses).
-- `authenticated` role gets a bank_id-scoped policy.
--
-- Rollback: DROP POLICY phase84a_* + ALTER TABLE ... DISABLE ROW LEVEL SECURITY.

BEGIN;

DO $$
DECLARE
  t text;
  -- Tables with direct bank_id column
  tables_with_bank_id text[] := ARRAY[
    'deal_financial_facts','deal_spreads','canonical_memo_narratives',
    'document_artifacts','deal_truth_events',
    'deal_upload_sessions','deal_upload_session_files'
  ];
  -- Tables with only uuid-typed deal_id — scope via deals lookup
  -- (credit_memo_drafts, credit_memo_snapshots moved here after schema check
  --  showed no bank_id column — see Phase 84 T-01 AAR)
  tables_deal_only_uuid text[] := ARRAY[
    'credit_memo_drafts','credit_memo_snapshots',
    'credit_memo_citations','document_ocr_words','document_ocr_page_map'
  ];
  -- Tables with text-typed deal_id — cast deals.id to text for predicate
  -- (memo_runs, risk_runs store deal_id as text, not uuid — see AAR)
  tables_deal_only_text text[] := ARRAY['memo_runs','risk_runs'];
BEGIN
  -- Enable RLS + service-role pass-through + bank_id-scoped authenticated policy
  FOREACH t IN ARRAY tables_with_bank_id LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'phase84a_' || t || '_service_role', t
    );
    EXECUTE format(
      $q$CREATE POLICY %I ON public.%I 
         FOR ALL TO authenticated 
         USING (bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', ''))
         WITH CHECK (bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', ''));$q$,
      'phase84a_' || t || '_tenant_scope', t
    );
  END LOOP;

  -- Tables with uuid-typed deal_id: join to deals.bank_id (direct)
  FOREACH t IN ARRAY tables_deal_only_uuid LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'phase84a_' || t || '_service_role', t
    );
    EXECUTE format(
      $q$CREATE POLICY %I ON public.%I 
         FOR ALL TO authenticated 
         USING (EXISTS (
           SELECT 1 FROM public.deals d 
           WHERE d.id = %I.deal_id 
             AND d.bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', '')
         ));$q$,
      'phase84a_' || t || '_tenant_scope', t, t
    );
  END LOOP;

  -- Tables with text-typed deal_id: cast deals.id to text for predicate
  FOREACH t IN ARRAY tables_deal_only_text LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'phase84a_' || t || '_service_role', t
    );
    EXECUTE format(
      $q$CREATE POLICY %I ON public.%I 
         FOR ALL TO authenticated 
         USING (EXISTS (
           SELECT 1 FROM public.deals d 
           WHERE d.id::text = %I.deal_id 
             AND d.bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', '')
         ));$q$,
      'phase84a_' || t || '_tenant_scope', t, t
    );
  END LOOP;
END$$;

COMMIT;
```

### Post-deploy acceptance

1. **Pre-work query** re-run. All 14 tables show `rls_enabled=true, policy_count=2`.

2. **Advisor delta:**
   ```sql
   -- Before: 82 rls_disabled_in_public findings
   -- After:  ~68 (82 - 14)
   ```
   Run `get_advisors type=security` and count `rls_disabled_in_public` entries.

3. **Smoke test — service role path (should still work):**
   ```sql
   -- Via Supabase SQL editor (service role context):
   SELECT COUNT(*) FROM deal_financial_facts; -- Should return 1366 or current count
   SELECT COUNT(*) FROM canonical_memo_narratives; -- Should return current count
   ```

4. **Smoke test — authenticated caller (should work for own bank):**
   Hit `GET /api/deals/[realDealId]/state` from a browser session authenticated to that deal's bank. Should return `200` with non-empty body. This confirms the Clerk → Supabase auth path propagates `bank_id` into JWT claims.

5. **Smoke test — authenticated caller, wrong bank (should return empty):**
   From a browser session authenticated to bank X, query a deal owned by bank Y via a test endpoint. Should return 403 or empty set.

6. **Emit ledger event:**
   Written to `buddy_system_events` (the system-event surface) because `deal_events.deal_id`
   is NOT NULL and the completion marker has no deal context. `event_type` is constrained
   to a fixed enum; `'deploy'` is semantically correct (the RLS migration is a schema
   deployment) and the original `'phase.84.t01a.completed'` string lives in `payload.kind`
   so downstream queries by kind still work. See T-01 AAR for rationale.
   ```sql
   INSERT INTO buddy_system_events (
     event_type, severity, source_system, resolution_status, payload
   ) VALUES (
     'deploy', 'info', 'phase_84', 'resolved',
     jsonb_build_object(
       'kind', 'phase.84.t01a.completed',
       'tables_enabled', 14,
       'batch', 'A',
       'spec_deviations', jsonb_build_array(
         'credit_memo_drafts and credit_memo_snapshots reclassified to deal_only (no bank_id column)',
         'memo_runs and risk_runs split into text-typed deal_only variant (deal_id is text not uuid)',
         'completion marker written to buddy_system_events instead of deal_events (deal_events.deal_id is NOT NULL)',
         'event_type=deploy + payload.kind=phase.84.t01a.completed (buddy_system_events.event_type enum does not include phase.* values)'
       )
     )
   );
   ```

### Rollback

```sql
BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE policyname LIKE 'phase84a_%' GROUP BY tablename LOOP
    EXECUTE format('DROP POLICY IF EXISTS phase84a_%I_service_role ON public.%I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS phase84a_%I_tenant_scope ON public.%I;', t, t);
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END$$;
COMMIT;
```

### Deferred to Phase 84.1 (Batch B)

These tables are deferred to a follow-up because they either (a) live outside the core fact/memo path, or (b) may have admin/operator access patterns worth auditing before RLS lands:

```
deal_monitoring_programs, deal_monitoring_obligations, deal_monitoring_cycles,
deal_monitoring_exceptions, deal_annual_reviews, deal_renewal_prep,
deal_annual_review_cases, deal_renewal_cases,
deal_review_case_requirements, deal_review_case_exceptions,
deal_review_case_outputs, deal_watchlist_cases, deal_watchlist_reasons,
deal_watchlist_events, deal_workout_cases, deal_workout_events,
deal_workout_action_items, pricing_scenarios, pricing_decisions,
deal_pricing_inputs, deal_pricing_quotes, pricing_terms,
rate_index_snapshots, deal_rent_roll_rows, financial_review_resolutions,
builder_decisions, checklist_item_matches, banker_queue_snapshots,
banker_focus_sessions, banker_queue_acknowledgements, deal_entities,
entity_relationships, deal_flags, deal_flag_audit, deal_flag_send_packages,
deal_borrower_questions, deal_committee_decisions, deal_loan_decisions,
deal_distribution_snapshots, deal_distribution_actions,
deal_credit_memo_status, deal_decision_finalization,
deal_policy_exceptions, deal_policy_exception_actions,
deal_structuring_selections, deal_structuring_freeze,
structuring_recommendation_snapshots, deal_spread_runs, deal_spread_jobs,
buddy_research_quality_gates, buddy_covenant_packages,
buddy_covenant_overrides, buddy_borrower_reports,
buddy_validation_reports, buddy_ai_use_cases, buddy_eval_runs,
buddy_eval_scores, buddy_industry_benchmarks, borrower_owner_attestations,
bank_policy_rules, bank_loan_product_types, bank_match_hints,
loan_product_types, platform_capabilities, memo_sections,
peis_mission_objects, risk_factors
```

Phase 84.1 also covers: 46 `security_definer_view` ERROR findings, 88 `function_search_path_mutable` WARNs, vector ext in public schema, and the `borrower_owner_attestations` borrower→deal→bank scoping.

---

# Wave 1 — Stop the bleeding

## T-02 — Document classifier output truncation (root cause revised)

**Finding reference (post-execution revision):** 89 distinct documents across Apr 1 → Apr 20 emitted `DOC_GATEKEEPER_CLASSIFY_FAILED` with `reasons: ["Gemini classifier returned null on text path"]` and `review_reason_code: NO_OCR_OR_IMAGE`. The 44/44 figure in v2 was only the Apr 15 burst — the real scope is larger and the failures are deterministic, not transient.

### Actual root cause (two compounding bugs)

**Bug A — Output-token truncation (the primary failure):**

`classifyWithGeminiText` and `classifyWithGeminiVision` in `src/lib/gatekeeper/geminiClassifier.ts` set `generationConfig.maxOutputTokens: 512`. This number was inherited from the Phase 24 OpenAI classifier (`src/lib/gatekeeper/classifyWithOpenAI.ts` — same 512, two sites). OpenAI tolerated the cap because `zodResponseFormat` enforces the schema server-side and returns valid JSON regardless of cap. Gemini returns raw JSON text; any cap-induced truncation causes `JSON.parse` to throw, which `parseGeminiResult` catches and returns `null`, which `runGatekeeperForDocument` interprets as `no_ocr_no_image` / `NO_OCR_OR_IMAGE`. The misleading label made the bug look like an OCR-availability issue for weeks.

**Bug B — Silent-write swallowing (why Bug A was invisible):**

`stampDocument` in `src/lib/gatekeeper/runGatekeeper.ts` awaited `.update()` without destructuring `{ error }`. Supabase JS returns CHECK constraint violations, RLS blocks, and permission errors in-band on the response object — **`.update()` does not throw**. The `try/catch` in `stampDocument` therefore never fired on constraint errors. This let a second bug (CHECK constraint drift, below) silently discard 9 `PERSONAL_FINANCIAL_STATEMENT` classifications across weeks while callers received phantom "success" returns.

**Bug C — Enum drift on `deal_documents.gatekeeper_doc_type` (Bug B's trigger):**

`GatekeeperDocType` in `src/lib/gatekeeper/types.ts` includes `PERSONAL_FINANCIAL_STATEMENT`, but the DB CHECK constraint `deal_documents_gatekeeper_doc_type_check` was never migrated to add it. Classifier output → DB CHECK rejection → silently swallowed by Bug B.

### Pre-work (revised)

```sql
-- 1. Scope: count unique failed docs across the full history
SELECT COUNT(DISTINCT payload->'input'->>'document_id') AS unique_failed_docs,
       MIN(created_at) AS earliest, MAX(created_at) AS latest,
       COUNT(*) AS event_count
FROM deal_events WHERE kind = 'DOC_GATEKEEPER_CLASSIFY_FAILED';

-- 2. Pick a failed doc with known-good OCR for probe target
SELECT dd.id, length(ocr.extracted_text) AS ocr_len
FROM deal_documents dd
JOIN document_ocr_results ocr ON ocr.attachment_id = dd.id
WHERE dd.gatekeeper_review_reason_code = 'NO_OCR_OR_IMAGE'
  AND length(ocr.extracted_text) > 10000
LIMIT 1;

-- 3. Drift audit: compare TS enum vs DB CHECK constraint
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.deal_documents'::regclass
  AND conname = 'deal_documents_gatekeeper_doc_type_check';
-- Cross-reference GatekeeperDocType in src/lib/gatekeeper/types.ts
```

### Implementation

**Step 1 — Observability (`src/lib/gatekeeper/geminiClassifier.ts`):**

Add `console.warn` at each of the 8 null-return exit points (4 each in `classifyWithGeminiText` and `classifyWithGeminiVision`): missing API key, non-ok HTTP response, `parseGeminiResult` null return, thrown exception. HTTP warns include `status/statusText/bodyPreview/model`. Parse-null warns include `finishReason` and `rawTextPreview`. Throw warns include `error.message/error.name`.

Also log `finishReason` on the success path when it is anything other than `"STOP"` — surfaces `MAX_TOKENS`, `SAFETY`, `RECITATION` even when JSON happens to parse cleanly.

**Step 2 — Token cap + thinking cap (`src/lib/gatekeeper/geminiClassifier.ts`):**

```typescript
generationConfig: {
  responseMimeType: "application/json",
  temperature: 0.0,
  maxOutputTokens: 2048,            // was 512 — truncated PTRs with multi-reason output
  thinkingConfig: {
    thinkingLevel: "low",            // caps Gemini 3 reasoning budget for strict-schema tasks
  },
},
```

Apply to both text and vision paths. Gemini 3 family counts reasoning tokens against the output budget; `thinkingLevel: "low"` gives the JSON response enough headroom at 2048.

**Step 3 — CHECK constraint migration:**

Drop and re-add `deal_documents_gatekeeper_doc_type_check` with `PERSONAL_FINANCIAL_STATEMENT` in the allowed array. Migration name `phase_84_t02b_gatekeeper_doc_type_add_pfs`.

**Step 4 — Fix silent-write bug in `stampDocument`:**

Destructure `{ error }` from `.update()`. If truthy, `console.error` with `code/message/hint` and throw. Re-throw in outer catch so the fail-closed path in `runGatekeeperForDocument` converts to NEEDS_REVIEW instead of returning a phantom success.

**Step 5 — Bulk reclassify:**

Write `scripts/phase-84-t02-reclassify-failed-batch.ts` with safety bounds (`--confirm` flag required, `MAX_DOCS` cap, concurrency 3, summary table). Iterate every doc that ever emitted `DOC_GATEKEEPER_CLASSIFY_FAILED` and is currently UNKNOWN / needs_review. Call `runGatekeeperForDocument({ forceReclassify: true })`.

### Post-deploy acceptance

1. Probe `scripts/phase-84-t02-reclassify-probe.ts` against a known-failed doc returns `doc_type` ≠ UNKNOWN, `input_path: "text"`, `needs_review: false`, no observability warnings fired.
2. Production DB row for that doc is stamped with the correct doc type + `gatekeeper_model: gemini-3-flash-preview` + a fresh `gatekeeper_classified_at`.
3. Bulk batch resolution: ≥ 95% of ever-failed docs now have `gatekeeper_doc_type != 'UNKNOWN'`. Remaining UNKNOWNs have `reviewReasonCode: UNKNOWN_DOC_TYPE` (legitimate model-can't-classify), not `NO_OCR_OR_IMAGE`.
4. `DOC_GATEKEEPER_CLASSIFY_FAILED` count in the 15 minutes following batch re-run = 0.
5. `[Gatekeeper] stampDocument write failed` log line present in Vercel for any future constraint violation (the new error-handling path) — validates Bug B fix catches future drift loudly.

---

## T-03 — Observer dedup / cooldown (CONVERTED TO AUDIT-ONLY)

**Status:** CLOSED as audit-only. No DDL, no code, no migration. See `docs/archive/phase-84/T03-observer-dedup-audit.md` and `docs/archive/phase-84/AAR_PHASE_84_T03.md`.

**Why:** Pre-work revealed the storm had already stopped. The `NO_SPREADS_RENDERED` emission the v2 spec targeted had been deleted from the codebase, and replaced by 6 per-invariant emissions in `src/lib/aegis/spreadsInvariants.ts`, each with an inline existence-check dedup before `writeSystemEvent`. Last critical observer event: **2026-04-17 13:45:41 UTC** — three days before T-03 execution began. Observer critical event count on 2026-04-18, 2026-04-19, 2026-04-20: **0/day** each.

**Original finding (preserved for historical context):** 7,028 `NO_SPREADS_RENDERED` critical events in 48 hours, all with `observer_decision: job_marked_dead` for the same stale jobs.

### What the v2 spec proposed

Create a dedicated `observer_dedup` table with `(key, last_fired_at)`, build a `shouldFireAlert()` helper, wrap every `writeSystemEvent` call in the observer in a cooldown check.

### What was actually done (out-of-band before T-03 started)

An earlier refactor (landed on or before 2026-04-17 13:45:41) deleted the bare `NO_SPREADS_RENDERED` emission and replaced it with per-invariant `writeSystemEvent` calls. Each invariant (`spread_generating_timeout`, `spread_job_orphan_check`, `snapshot_blocked_by_stale_spreads`, `409_intelligence_stale_spread`, `409_intelligence_failed_jobs`, `snapshot_recompute_422`) carries an inline existence-check dedup:

```typescript
const { count: existingCount } = await sb
  .from("buddy_system_events")
  .select("id", { count: "exact", head: true })
  .eq("deal_id", spread.deal_id)
  .in("resolution_status", ["open", "retrying"])
  .contains("payload", { invariant: "spread_generating_timeout" });
if ((existingCount ?? 0) > 0) continue;
```

Different mechanism than the v2 spec's `observer_dedup` table, same intent, same outcome. An alert fires once per `(deal_id, invariant)` and then silences itself until the prior event is resolved.

### Current state vs v2 acceptance

| v2 criterion | Current (2026-04-20) | Status |
|---|---|---|
| Critical observer events < 200/24h | **0** (vs v2 target < 200) | ✓ vastly exceeded |
| No dedup key fires > once per cooldown | 723 unique warnings in 723 rows | ✓ |
| Genuine new failures still fire | Each unique worker ID gets one flag | ✓ |
| `observer_dedup` table populated | N/A — different mechanism | ✓ (intent met) |

### Phase 84.1 follow-up

Worker-churn rate investigation. 723 warnings/24h = ~30/hour = a worker flagged dead every 2 minutes. Each alert fires exactly once per unique worker (dedup is working), but the underlying rate is high enough to suggest Cloud Run idle-timeout, worker crashes, or deployment churn. Not a T-03 scope concern; tracked separately.

---

# Wave 2 — Close the truth loop

## T-04 — Wire `gemini_primary_v1` through `runRecord.ts`

**Finding reference:** `deal_extraction_runs` is permanently empty. 1,366 facts via 10 extractor paths, 0 runs logged. `runRecord.ts` exports are not re-exported from `index.ts` and no extractor call site invokes them.

**Scope firmed from v1:** `runRecord.ts` is **NOT disposable**. The `agent_workflow_runs` view (Phase 72C) explicitly unions `deal_extraction_runs` with a `'document_extraction'` workflow code and promotes `cost_usd`, `input_tokens`, `output_tokens` columns. Deleting the run ledger would break the view. The only v2 path is wiring, not removal.

### Pre-work

```sql
-- Confirm extractor distribution
SELECT 
  provenance->>'extractor' AS extractor,
  COUNT(*) AS facts,
  COUNT(DISTINCT source_document_id) AS docs,
  MAX(created_at)::date AS latest
FROM deal_financial_facts
WHERE fact_type != 'EXTRACTION_HEARTBEAT'
  AND created_at > NOW() - INTERVAL '14 days'
GROUP BY 1
ORDER BY facts DESC;
```

Expected: `gemini_primary_v1` is the top volume path. If it's not, stop and ask — the wiring target may have shifted.

```sql
-- Verify agent_workflow_runs view still includes deal_extraction_runs
SELECT view_definition FROM information_schema.views
WHERE table_name = 'agent_workflow_runs' AND table_schema = 'public';
```

If the view no longer includes `deal_extraction_runs` union, the premise of T-04 has shifted — stop and ask.

### Implementation

**Step 1 — Re-export run primitives:**

Edit `src/lib/extraction/index.ts`, add:
```typescript
// Run lifecycle — Phase 84 T-04
export {
  createExtractionRun,
  finalizeExtractionRun,
  markRunRunning,
  getLatestExtractionRun,
  CURRENT_PROMPT_VERSION,
  CURRENT_SCHEMA_VERSION,
  type ExtractionRunRow,
  type ExtractionRunStatus,
  type CreateRunArgs,
  type FinalizeRunArgs,
} from "./runRecord";
```

**Step 2 — Wrap `extractWithGeminiPrimary`:**

The function lives at `src/lib/financialSpreads/extractors/gemini/geminiDocumentExtractor.ts` (per Phase 80 wiring reference). Wrap body in run lifecycle:

```typescript
import { createExtractionRun, finalizeExtractionRun, markRunRunning } from "@/lib/extraction";
import { GEMINI_FLASH } from "@/lib/ai/models";

export async function extractWithGeminiPrimary(args) {
  const { run, reused } = await createExtractionRun({
    dealId: args.dealId,
    documentId: args.documentId,
    ocrText: args.ocrText,
    canonicalType: args.docType,
    yearHint: args.docYear,
    structuredEngine: "gemini_flash",
    structuredModel: GEMINI_FLASH,
  });

  if (reused && run.status === "succeeded") {
    return { ok: true, items: [], reused: true };
  }

  await markRunRunning(run.id);
  const started = Date.now();

  try {
    const result = await doGeminiExtraction(args);  // existing logic
    await finalizeExtractionRun({
      runId: run.id,
      dealId: args.dealId,
      documentId: args.documentId,
      status: result.ok ? "succeeded" : "failed",
      failureCode: result.ok ? null : mapErrorToFailureCode(result.error),
      outputHash: result.ok ? computeOutputHash(result.items) : null,
      metrics: {
        cost_estimate_usd: result.costUsd,
        tokens_in: result.inputTokens,
        tokens_out: result.outputTokens,
        latency_ms: Date.now() - started,
        canonicalType: args.docType,
        taxYear: args.docYear,
      },
    });
    return result;
  } catch (err) {
    await finalizeExtractionRun({
      runId: run.id,
      dealId: args.dealId,
      documentId: args.documentId,
      status: "failed",
      failureCode: "UNKNOWN_FATAL",
      failureDetail: { message: String(err) },
      metrics: { latency_ms: Date.now() - started },
    });
    throw err;
  }
}
```

**Step 3 — Document follow-up scope:**

The other 9 extractors (`personalIncomeExtractor`, `materializeFactsFromArtifacts`, `extractFactsFromDocument:v5`, `gemini_primary_schedule_detect`, `backfillCanonicalFactsFromSpreads`, `persistGlobalCashFlow`) are explicitly deferred to Phase 84.1. Do not wire them in this ticket.

### Post-deploy acceptance

1. Within 2 hours, `deal_extraction_runs` has ≥ 1 row with `status='succeeded'`.
2. Within 24 hours, `deal_extraction_runs` row count is within 10% of `gemini_primary_v1` doc count in that window.
3. `deal_extraction_runs.cost_usd` is non-null for ≥ 50% of new rows.
4. Operator console (`/ops/agents`) shows non-empty `document_extraction` workflow rows.

---

## T-05 — Audit checklist taxonomy split (rewritten from v1)

**Finding reference:** v1 said "no checklist items reach `satisfied`". That was based on `deal_checklist_items` (the legacy table). The canonical Phase 66 table `deal_document_items` actually shows **20 satisfied, 44 received, 15 missing** across 9 deals. `deal_document_snapshots` shows **71–100% readiness** on 7 deals. The propagation system IS working.

**v2 premise:** Buddy has two parallel "checklist" systems:

1. **Legacy** — `deal_checklist_items` table. Flipped `missing → received` by `create_checklist_match()` DB function (SECURITY DEFINER, monotonic upgrade only). `reconcileChecklistForDeal()` in `src/lib/checklist/engine.ts` emits `checklist.reconciled` events (verified: 65 events in past 7 days) and `deal.checklist.updated` + `deal.borrower.completed` when thresholds hit. No `received → satisfied` promotion path exists on this table — this is by design; the function explicitly notes "monotonic upgrade."

2. **Canonical Phase 66** — `deal_document_items` + `deal_document_snapshots`. Written by `src/lib/documentTruth/recomputeDealDocumentState.ts`. This table has the full `missing/received/satisfied` taxonomy and is what drives `ReadinessPanel` via the cockpit-state endpoint.

The v1 audit query (which showed 0 `satisfied`) looked at the **legacy** table. That's not a bug — legacy never had `satisfied`. This was a reader error in the audit, not a propagation failure.

### The real questions this ticket must answer

1. **Which table do production cockpit panels read from?**
   - `CanonicalChecklistPanel` (Phase 67) should read from `cockpit-state.document_state.requirements` which reads from canonical. Verify.
   - Any UI surface still reading the legacy table is a latent bug.

2. **Are there any stale readers of `deal_checklist_items.status='satisfied'`?**
   - That would be broken code (the legacy table never writes `satisfied`). Must be grep'd.

3. **Should the legacy table be retired?**
   - If all readers moved to canonical, `deal_checklist_items` is dead weight. Retirement goes in Phase 84.1.

### Pre-work

**Query A — Legacy vs canonical discrepancy:**
```sql
SELECT
  (SELECT COUNT(*) FROM deal_checklist_items WHERE status='satisfied') AS legacy_satisfied,
  (SELECT COUNT(*) FROM deal_checklist_items WHERE status='received')  AS legacy_received,
  (SELECT COUNT(*) FROM deal_checklist_items WHERE status='missing')   AS legacy_missing,
  (SELECT COUNT(*) FROM deal_document_items WHERE checklist_status='satisfied') AS canon_satisfied,
  (SELECT COUNT(*) FROM deal_document_items WHERE checklist_status='received')  AS canon_received,
  (SELECT COUNT(*) FROM deal_document_items WHERE checklist_status='missing')   AS canon_missing;
```
Expected as of 2026-04-17: legacy_satisfied=0, legacy_received=180, legacy_missing=1076; canon_satisfied=20, canon_received=44, canon_missing=15.

**Query B — Active DB triggers on `deal_checklist_items`:**
```sql
SELECT 
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'deal_checklist_items'
  AND NOT t.tgisinternal;
```

**Query C — Grep the codebase for legacy readers:**
```bash
grep -rn "deal_checklist_items" src/app/api/ src/components/ src/app/\(app\)/ | grep -v __tests__ | grep -v ".test." | grep -v "from.*deal_checklist_items"
```
Filter to reads (not writes). Any UI component or API route reading `.status='satisfied'` from this table is a latent bug.

**Query D — Confirm cockpit-state reads canonical:**
```bash
grep -rn "deal_document_items\|deal_document_snapshots" src/app/api/deals/
```

### Implementation (contingent on pre-work)

**If Query A confirms the expected split (canonical healthy, legacy no `satisfied` path):**

1. Add a deprecation comment to the legacy table and function:
   ```sql
   COMMENT ON TABLE public.deal_checklist_items IS 
     'LEGACY as of Phase 66. Canonical truth is deal_document_items + deal_document_snapshots. 
      This table is still written by create_checklist_match() but should not be read by new code. 
      Retirement tracked in Phase 84.1.';

   COMMENT ON FUNCTION public.create_checklist_match IS
     'LEGACY: writes to deal_checklist_items. New code should use the Phase 66 canonical 
      recomputeDealDocumentState pipeline (writes deal_document_items + deal_document_snapshots).';
   ```

2. Write a one-page audit report at `docs/archive/phase-84/T05-checklist-taxonomy-audit.md` capturing:
   - Query A numbers
   - Query B output (triggers list)
   - Query C output (any legacy readers in UI/API)
   - Query D output (canonical readers confirmed)
   - Decision: retire legacy in 84.1, OR bridge legacy to canonical, OR accept dual-track

**If Query C shows production UI paths still reading legacy:**
- Flag each as a follow-up ticket for Phase 84.1
- In this ticket, add a `/api/ops/health` query that surfaces the legacy/canonical discrepancy

**If Query D shows cockpit-state NOT reading canonical:**
- Stop and escalate. The Phase 67 AAR claimed this was wired. This would be a serious regression.

### Post-deploy acceptance

1. Audit report file exists at `docs/archive/phase-84/T05-checklist-taxonomy-audit.md` with all four query outputs.
2. If legacy readers were found, each is ticketed in Phase 84.1.
3. Legacy table + function have deprecation comments attached.

**Explicit non-goals for this ticket:**
- Do NOT add a `satisfied` promotion to the legacy table. Doing so would widen the legacy/canonical split instead of closing it.
- Do NOT bridge legacy and canonical via a trigger — that locks in the dual-track.
- Do NOT rewrite any production reader without a separate ticket.

---

## T-06 — Deal creation idempotency guard

**Finding reference:** Four duplicate `Ellmann & Elmann Part 2` deals on 2026-04-15 — two with facts, two empty shells. The duplicates were created by the same banker re-submitting over a 79-minute span (intervals 35 min, 16 min, 28 min), not by client-side retries. Root cause: perceived-failure re-submit driven by the T-02 classifier bug (first uploads produced 0 facts → banker thought it broke → created new deal → repeat). The 60s trigger window in v1/v2 would have caught zero of these.

### Revised guard shape (post pre-work)

**Primary: RPC-level dedup inside `deal_bootstrap_create`.** Before INSERT, look for an existing deal with matching `(bank_id, created_by_user_id, lower(trim(name)))` created within a configurable window (default 4h, override via `SET app.deal_dedup_window`). On hit, reuse the existing `deal_id` and create a fresh upload session pointing at it. Returns a new `reused boolean` column so callers can distinguish cache hits.

**Secondary: app-layer helper `checkDuplicateDeal` at direct-insert routes.** Mirrors the RPC predicate exactly. Used by `/api/deals/create` and `/api/deals/route.ts` (the two routes that bypass the RPC). Fail-open on lookup error — the RPC remains the authoritative backstop.

**Deferred: `Idempotency-Key` header opt-in.** Tracked as **T-06-B** in Phase 84.1. The current failure mode (banker re-submit) is fully covered by the user-scoped window; `Idempotency-Key` is for well-behaved clients with stable keys, of which we have zero evidence today.

**Route coverage:**

| Route | Protection |
|---|---|
| `POST /api/deals/create` | app-layer helper (direct insert) |
| `POST /api/deals/bootstrap` | RPC-level (via `deal_bootstrap_create`) |
| `POST /api/uploads/sessions` | RPC-level (via `deal_bootstrap_create`) |
| `POST /api/deals/route.ts` | app-layer helper (direct insert) |
| `POST /api/deals/new/upload-session` | n/a — returns 410 (deprecated) |
| `POST /api/deals/seed` | n/a — blocked in production |
| `POST /api/builder/deals/mint` | intentionally bypassed (bulk builder) |
| `POST /api/sandbox/seed`, `POST /api/admin/demo/hygiene/reset` | intentionally bypassed (demo/sandbox) |

### Implementation

**Migration 1 — schema (`20260420140000_phase_84_t06_idempotency_guard_schema.sql`):**
- `ALTER TABLE deals ADD COLUMN IF NOT EXISTS created_by_user_id text, duplicate_of uuid REFERENCES deals(id)`
- Backfill `created_by_user_id` from earliest `deal_upload_sessions` per deal
- `CREATE INDEX idx_deals_dedup_lookup ON deals (bank_id, created_by_user_id, lower(trim(name)), created_at DESC) WHERE duplicate_of IS NULL`
- Flag the Ellmann cluster (canonical = `7d76458d-...`, 3 duplicates pointed at it, all 4 `is_test=true`). Fact re-parenting (540 facts, 1213 events, ~1883 rows across 8 tables) deferred to Phase 84.1.

**Migration 2 — RPC body (`20260420150000_phase_84_t06_idempotency_guard_rpc.sql`):**
- `DROP FUNCTION deal_bootstrap_create(uuid, text, text, text, uuid, text, text, text)` (required because return type changes)
- Recreate with dedup branch + `reused boolean` column in the return TABLE
- Populates `created_by_user_id` on new inserts
- Always creates a fresh upload session (reused deals get a new session; expired existing sessions aren't re-used)

**App-layer:**
- `src/lib/deals/checkDuplicateDeal.ts` — helper with same predicate as RPC, fail-open, user-scoped
- `/api/deals/create/route.ts` — calls helper before `.insert()`, stamps `created_by_user_id` on INSERT
- `/api/deals/route.ts` — calls helper after demo-bank path, stamps `created_by_user_id`
- `src/lib/uploads/createUploadSessionApi.ts` — reads `reused` from the RPC row, skips quick_look mode patch on reused deals, logs the flag

### Post-deploy acceptance

1. Both migrations in `supabase_migrations.schema_migrations`: `phase_84_t06_idempotency_guard_schema`, `phase_84_t06_idempotency_guard_rpc`.
2. `deal_bootstrap_create` called twice with same `(bank_id, name, user_id)` within 4h → second returns `reused=true` + same `deal_id`.
3. Different name → `reused=false` + new `deal_id`.
4. Same name + bank, different user → `reused=false` + new `deal_id`.
5. Different bank → `reused=false` + new `deal_id`.
6. `/api/deals/create` with same name+user+bank within 4h → second returns 200 with `reused: true` (not 201).
7. Ellmann graph intact: 3 duplicates point at `7d76458d`, canonical has `duplicate_of = NULL`.

### Post-deploy acceptance

1. `POST /api/deals/create` with same `name` + `bank_id` twice in 60s returns 409 on second attempt.
2. `POST /api/deals/create` with same `Idempotency-Key` twice returns `reused: true`.
3. The two empty Ellmann shells have `duplicate_of` populated.

---

# Wave 3 — Restore advisory + governance

## T-07 — Narrow Omega fix: `underwrite/state` fallback

**Finding reference (narrowed from v1):** Pulse-backed `omega://` RPC calls fail 100% with `Method not found`. The user-facing `/api/deals/[dealId]/state` route already has a working `ai_risk_runs` fallback via `synthesizeAdvisoryFromRisk()` (verified against `src/core/omega/OmegaAdvisoryAdapter.ts`). The narrow problem is that the Phase 79 `/api/deals/[dealId]/underwrite/state` route does NOT use that fallback — its `omegaAdvisory` field is always null.

**Decision:** Do not rewrite `invokeOmega` with a full Pulse-adapter layer in this ticket. That was v1's scope. It adds complexity for partial value — Pulse's actual advisory surface isn't mature enough to translate `omega://confidence/evaluate` meaningfully. Instead, preserve the existing fallback and extend it to `underwrite/state`.

If/when Pulse ships native `omega://` handlers or a richer advisory tool, T-07-B in Phase 84.1 can do the full adapter.

### Pre-work

```sql
-- Confirm which resources Buddy is calling and the exact failure mode
SELECT 
  payload->>'resource' AS resource,
  payload->>'error' AS error,
  COUNT(*) AS count
FROM buddy_signal_ledger
WHERE type IN ('omega.invoked','omega.failed','omega.succeeded')
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY payload->>'resource', payload->>'error'
ORDER BY count DESC;
```

```bash
# Confirm the state route HAS the fallback (should be present per Phase 65A)
grep -n "synthesizeAdvisoryFromRisk\|ai_risk_runs" src/app/api/deals/\[dealId\]/state/route.ts

# Confirm underwrite/state does NOT have the fallback yet
grep -n "synthesizeAdvisoryFromRisk\|ai_risk_runs" src/app/api/deals/\[dealId\]/underwrite/state/route.ts
```

Expected state: first grep returns 2+ hits, second grep returns 0.

### Implementation

In `src/app/api/deals/[dealId]/underwrite/state/route.ts`:

**Critical:** the two routes use different `omegaAdvisory` shapes — you cannot dump `synthesizeAdvisoryFromRisk`'s `OmegaAdvisoryState` into this route's response without translation.

- `/api/deals/[dealId]/state` consumers read `OmegaAdvisoryState` directly: `{ confidence, advisory, riskEmphasis, traceRef, stale, staleReason }` (camelCase).
- `/api/deals/[dealId]/underwrite/state` consumers expect a 4-field domain shape: `{ confidence, risk_emphasis, recommended_focus, advisory_grade }` (snake_case, includes `advisory_grade` which doesn't exist in `OmegaAdvisoryState`).

The correct pattern is **shape translation** in the fallback branch:

```typescript
// at top of file (alongside existing imports)
// — keep the existing dynamic imports of invokeOmega/redactForOmega —

if (omegaResult.ok) {
  omegaAdvisory = omegaResult.data;
} else {
  // Phase 84 T-07: Pulse unavailable → fall back to ai_risk_runs.
  // Translate OmegaAdvisoryState into this route's declared 4-field contract.
  try {
    const { synthesizeAdvisoryFromRisk } = await import(
      "@/core/omega/OmegaAdvisoryAdapter"
    );
    const { data: riskRow } = await sb
      .from("ai_risk_runs")
      .select("result_json")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (riskRow?.result_json) {
      const risk = riskRow.result_json as {
        grade?: string;
        factors?: Array<{
          label: string;
          direction: "positive" | "negative" | "neutral";
          rationale: string;
          confidence?: number;
        }>;
      };
      const synthesized = synthesizeAdvisoryFromRisk(risk);
      omegaAdvisory = {
        confidence: synthesized.confidence,
        risk_emphasis: synthesized.riskEmphasis,
        recommended_focus: synthesized.advisory || null,
        advisory_grade: risk.grade ?? null,
      };
    }
  } catch (fallbackErr) {
    console.warn("[underwrite/state] ai_risk_runs fallback failed", fallbackErr);
  }
}
```

Mapping choices:
- `synthesized.riskEmphasis` (array of negative-factor labels) → `risk_emphasis` — direct.
- `synthesized.advisory` (human-readable "Risk grade: X. Strengths: .... Watch: ...") → `recommended_focus`. Not a perfect semantic match (the original intent of `recommended_focus` was a banker-targeting hint), but the closest signal available. Documented in AAR as semantic compromise.
- `risk.grade` → `advisory_grade` — `synthesizeAdvisoryFromRisk`'s return shape does not expose `grade` as a standalone field, so read it directly from the source `result_json`.

**Consumer audit note:** grep for `omegaAdvisory\|advisory_grade\|recommended_focus\|risk_emphasis` across `src/components/` and `src/app/` returns zero non-route hits today. The route declares the shape but no UI reads it. This means the translation is forward-looking (no current UI regression risk) but still the right call to preserve the declared contract.

### What this explicitly does NOT do

- Does not rewrite `invokeOmega` with a protocol adapter
- Does not add new methods to Pulse
- Does not break the existing `/api/deals/[dealId]/state` fallback path
- Does not silence the `omega.failed` events — those still fire for observability

### Post-deploy acceptance

1. For any deal with a non-null `ai_risk_runs` row, `GET /api/deals/[dealId]/underwrite/state` returns a non-null `omegaAdvisory` with at least a `grade` or `advisory` string field.
2. `buddy_signal_ledger` events ratio unchanged — still 100% `omega.failed` from Pulse, because this ticket doesn't change Pulse calls. That's expected.
3. The user-facing `/api/deals/[dealId]/state` route continues to return its Phase 65A fallback correctly (regression check).
4. If `ai_risk_runs` is also empty for a deal, `omegaAdvisory` is `null`, and downstream UI handles this gracefully (no crash).

### Phase 84.1 follow-up

If bankers ask for real-time Pulse-backed advisories (beyond the ai_risk_runs static snapshot), that work is T-07-B:
- Define which Pulse tools (e.g. `memory_search`, `buddy_ledger_list`) can substitute for each `omega://` resource
- Build a proper adapter in `src/lib/omega/pulseAdapter.ts`
- Replace `Method not found` errors with `omega_unsupported_resource` in the ledger for clearer observability

---

## T-08 — Governance smoke test (CONVERTED TO AUDIT-ONLY)

**Status:** CLOSED as audit-only. No script, no synthetic fixture inserts. See [docs/archive/phase-84/T08-governance-writers-audit.md](../docs/archive/phase-84/T08-governance-writers-audit.md) and [docs/archive/phase-84/AAR_PHASE_84_T08.md](../docs/archive/phase-84/AAR_PHASE_84_T08.md).

**Why:** Pre-work revealed v2's premise was wrong at multiple layers.
- **3 of 6 governance tables have no writer anywhere in the repo** (`agent_approval_events`, `draft_borrower_requests`, `borrower_request_campaigns`) — schemas landed in Phase 73 / pre-64 / post-close-monitoring but the writers were never built.
- **2 of 6 tables have working writers** (`canonical_action_executions` at `src/core/actions/execution/executeCanonicalAction.ts`, `agent_skill_evolutions` at `src/lib/learningLoop/evolutionStager.ts`) — but neither has ever been invoked. One is starved of upstream input (`extraction_correction_log` has 0 rows, so `logCorrection()` is never called); the other has never been triggered by any banker workflow (`deriveNextActions()` likely returns empty for current deals, or the Execute Action UI surface isn't wired).
- **1 of 6 tables has a writer gated on reconciliation status** (`deal_decisions` via `/actions/approve`). Only 2 reconciliation runs have ever completed across the entire DB lifetime (2026-04-03 and 2026-04-14), both `CONFLICTS`. No deal has ever produced `CLEAN` or `FLAGS`.
- **Headline finding beyond the per-table map:** 0 non-test deals exist in the entire database. All 9 deals carry `is_test = true` after T-06 flagged the Ellmann cluster + the 5 ChatGPT Fix test deals. Every "empty table" finding in Phase 84 is consistent with a DB that has no real production activity, not a DB with broken infrastructure.
- **Endpoint paths in v2 were speculative.** `/api/admin/agent-approvals` doesn't exist. `/api/deals/[dealId]/draft-borrower-request` doesn't exist. The actual `borrower-request` route writes to a different system (Phase 73 portal invites, not Phase 75 AI-draft governance).

Synthetic fixture inserts (Option B in the planning conversation) were rejected because they would have polluted governance tables with `source: phase_84_t08_smoke` marker rows that every future audit, dashboard, or compliance review would need to filter out. That's the kind of band-aid that survives indefinitely and undermines the truth source.

### What T-08 delivered

7 Phase 84.1 ticket stubs (T-08-A through T-08-G), with **T-08-G (production activity baseline)** as the gating priority. Until T-08-G is answered (are there any live banks using Buddy today?), the priority ordering of the other 6 tickets is undefined. Full stubs in the audit doc.

Tables remain empty after T-08 closes. That is the correct state — they reflect reality, not broken infrastructure.

---

# Wave 4 — Housekeeping

## T-09 — Roadmap + env reconciliation

**Shift from v1:** "Reconcile, don't rewrite blind."

### Pre-work

```bash
# Read current roadmap state before editing
head -80 BUDDY_PROJECT_ROADMAP.md

# Confirm phase AARs present on main
ls AAR_PHASE_*.md | sort
```

Then read Vercel project env vars directly (or from the Vercel dashboard):
- `USE_GEMINI_OCR` — current value
- `GEMINI_OCR_MODEL` — current value
- `OMEGA_MCP_ENABLED`, `OMEGA_MCP_URL`, `OMEGA_MCP_API_KEY`, `OMEGA_MCP_TIMEOUT_MS`, `OMEGA_MCP_KILL_SWITCH`
- `CLERK_JWT_KEY` present/absent
- `OPENAI_REALTIME_*` — should be removed

### Implementation

**Part A — `.env.example` reconciliation:**

- Add `OMEGA_MCP_*` entries (all five)
- Add `CLERK_JWT_KEY` entry with comment explaining purpose
- Remove `OPENAI_REALTIME_*` (voice is fully Gemini since Phase 51)
- Change `USE_GEMINI_OCR` default to `true`
- Do NOT hardcode a replacement `GEMINI_OCR_MODEL` value — instead leave a comment pointing to current Gemini docs

**Part B — `BUDDY_PROJECT_ROADMAP.md` reconciliation:**

Do NOT replace the header with a hardcoded list. Instead:

1. Read current AAR files (`ls AAR_PHASE_*.md`)
2. Build the shipped-phase list dynamically from AAR filenames
3. Update "Last Updated" line to current date
4. Add a "Phase 84 — in progress" stub at the top with a pointer to this spec
5. Preserve the rest of the roadmap content (existing phase decompositions, build rules, etc.)

The goal is to anchor the top of the file to current reality without losing the historical record below.

### Post-deploy acceptance

1. `.env.example` diff applied correctly (verify via `git diff .env.example`).
2. `BUDDY_PROJECT_ROADMAP.md` header reflects current state and references this spec.
3. No regression in existing roadmap content — verify via `git diff --stat BUDDY_PROJECT_ROADMAP.md` shows only additive/header changes.

---

## T-10 — Repo hygiene + test-data flagging

*(Unchanged from v1.)*

### Implementation

**Part A — Archive 125+ root markdown files:**

```bash
mkdir -p docs/archive/phase-pre-84/
git mv AAR_PHASE_*.md docs/archive/phase-pre-84/ 2>/dev/null || true
git mv PHASE_*_SPEC.md docs/archive/phase-pre-84/ 2>/dev/null || true
git mv PHASE_*_TICKETS.md docs/archive/phase-pre-84/ 2>/dev/null || true
git mv PHASE_4_FILES.txt docs/archive/phase-pre-84/ 2>/dev/null || true
```

Preserve AAR references if any other Phase 84 tickets expect root-level paths during execution — rename only AFTER T-01 through T-08 complete.

Keep at root: `README.md`, `BUDDY_PROJECT_ROADMAP.md`, `BUDDY_BUILD_RULES.md`, `DEPLOYMENT.md`, `HOTFIX_LOG.md`.

Remove zero-byte artifacts: `funnel`, `node`, `buddy-the-underwriter@0.1.0`.

**Part B — Test-data flagging:**

```sql
ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_deals_is_test
  ON public.deals (is_test)
  WHERE is_test = false;

UPDATE deals SET is_test = true
WHERE name ILIKE 'ChatGPT Fix%';
```

**T-06 coordination:** the v2 spec's original UPDATE also included `OR duplicate_of IS NOT NULL`, but `duplicate_of` is a column **T-06 adds** (does not exist at the time T-10 Part B runs). Removed here; T-06 is responsible for flagging duplicate deals in its own cleanup step. When T-06 adds `duplicate_of`, its migration must also `UPDATE deals SET is_test=true WHERE duplicate_of IS NOT NULL` in the same transaction.

Update dashboard/analytics queries to filter `WHERE is_test = false`.

### Post-deploy acceptance

1. Root directory has ≤ 15 files.
2. Production dashboards show non-test deals only (Ellmann real + any others).
3. Zero-byte artifacts removed from repo root.

---

# Out of scope — Phase 84.1 backlog

1. **Samaritus deal restoration** — decide whether to recreate, pick a new canonical test deal, or accept the loss
2. **336 dead-lettered outbox replay** — with new Bearer token
3. **Re-extraction orchestrator actual retry** — currently simulated; depends on T-04
4. **Wire the other 9 extractors through `runRecord.ts`** — `personalIncomeExtractor`, `materializeFactsFromArtifacts`, `extractFactsFromDocument:v5`, `gemini_primary_schedule_detect`, `backfillCanonicalFactsFromSpreads`, `persistGlobalCashFlow`, etc.
5. **RLS Batch B** — 60+ remaining tables (monitoring, pricing, workout, renewal, annual review, etc.)
6. **46 `security_definer_view` ERROR findings** — per-view review
7. **88 `function_search_path_mutable` WARN findings** — bulk fix
8. **`rls_policy_always_true` tightening** — 39 findings
9. **Vector ext schema migration** — move from `public` to `extensions`
10. **Clerk JWT verification setup** — set `CLERK_JWT_KEY` in Vercel if not already
11. **T-05 follow-up: retire `deal_checklist_items`** if the audit confirms no production readers
12. **T-07-B: Full Pulse adapter** for real-time Omega if product needs richer advisories beyond `ai_risk_runs` fallback

---

# Execution protocol for Antigravity

**Before every ticket:**
1. Read this spec end-to-end once
2. Run the ticket's pre-work SQL and diagnostic commands
3. Report pre-work findings back in chat
4. **Confirm the ticket is still needed.** If pre-work shows the fix is already in place (e.g. a DB function already handles what the ticket proposes), convert the ticket to an audit ticket and skip implementation

**During a ticket:**
1. Only touch files named in the Implementation section
2. If a file path is ambiguous or differs from the spec, ask — do not guess
3. Commit with message `Phase 84 T-NN — <title>`

**After every ticket:**
1. Run the post-deploy acceptance checks as actual SQL queries
2. Create `docs/archive/phase-84/AAR_PHASE_84_T0N.md` with:
   - Pre-work results (verbatim SQL output)
   - Files changed (list with line counts)
   - Acceptance results (verbatim SQL output)
   - Deviations from spec with rationale
3. Verify the AAR file exists on `origin/main` via GitHub API read at `ref: main` — phantom-commit mitigation

**Cross-ticket dependencies:**
- T-02 (classifier) must complete BEFORE T-04 acceptance testing — if the classifier is broken, extraction runs won't fire for new docs and T-04 acceptance won't land
- T-01 (RLS) must complete BEFORE any external user testing of T-07/T-08
- T-10 Part B (test flag) should run BEFORE T-08 (governance smoke test)

---

# Success criteria for the phase as a whole

| Criterion | Pre-Phase-84 | v2 Target | Source |
|---|---|---|---|
| RLS-disabled cross-tenant tables (Batch A scope) | 14 | 0 | T-01 |
| 24h `DOC_GATEKEEPER_CLASSIFY_FAILED` rate | ~100% | < 5% | T-02 |
| 24h `NO_SPREADS_RENDERED` critical events | ~3,500 | < 200 | T-03 |
| `deal_extraction_runs` row count | 0 | ≥ 10 in 7 days | T-04 |
| Checklist taxonomy audit delivered | no | yes | T-05 |
| Duplicate deals by (bank_id, name, 60s window) | possible | blocked | T-06 |
| `/api/deals/[dealId]/underwrite/state` returns non-null `omegaAdvisory` | never | yes for deals with ai_risk_runs | T-07 |
| Governance tables each have ≥ 1 row | no | yes | T-08 |
| `.env.example` matches Vercel prod | partial | yes | T-09 |
| Root directory file count | ~125 | ≤ 15 | T-10 |

When all 10 criteria hold for 72 hours, Phase 84 is closed and Phase 84.1 opens.

---

# Changelog: v1 → v2

| Change | Reason |
|---|---|
| T-01 split into Batch A (14 tables, this phase) and Batch B (60+ tables, 84.1) | v1 migration blast radius too broad for one shot |
| T-03 removed "timeout" framing | `maxDuration=60` already set on observer route |
| T-04 removed "Option B: delete runRecord.ts" | Would break `agent_workflow_runs` view (Phase 72C union); Phase 72C cost-promotion work depends on the table |
| T-05 rewritten from "build propagation" to "audit the dual-table split" | Propagation (`create_checklist_match()`, `recomputeDealDocumentState`, `reconcileChecklistForDeal`) already exists in repo — v1 queried the legacy table and missed the canonical Phase 66 path |
| T-07 scope narrowed from "full Pulse adapter" to "extend existing ai_risk_runs fallback to underwrite/state" | `OmegaAdvisoryAdapter` + `synthesizeAdvisoryFromRisk()` fallback already lives in `state/route.ts`; the full adapter is deferred to 84.1 |
| T-09 phrased as "reconcile" not "rewrite" | Current roadmap state must be verified before editing |
| Pre-work on every ticket now includes an "is it already fixed?" check | v1 spec assumed several things were still broken that were in fact already fixed |
| Success criteria table more granular (10 rows vs 9) with source-ticket column | Easier tracking during execution |

---

## Appendix — Full findings → ticket crosswalk (v2)

| # | Finding | Addressed by (v2) |
|---|---|---|
| 1 | 82 tables RLS disabled | T-01 (Batch A, 14 tables) + 84.1 (Batch B, remainder) |
| 2 | Document classifier 100% failing | T-02 |
| 3 | "Checklist stuck" — audit correction | T-05 (audit only — propagation works) |
| 4 | `deal_extraction_runs` empty | T-04 |
| 5 | Re-extraction orchestrator simulated | 84.1 (depends on T-04) |
| 6 | Material drift detected 11×/7d | Resolves with T-02 + T-04 |
| 7 | Reconciliation runs on bad data | Resolves with T-02 |
| 8 | Omega Pulse calls 100% fail | T-07 (narrow: extend fallback); 84.1 for full adapter |
| 9 | Phase 80 lease/credit memo no facts | Resolves with T-02 |
| 10 | Output contracts half-wired | 84.1 |
| 11 | `runRecord.ts` dead code | T-04 |
| 12 | Spreads worker alerts | T-03 (dedup, not timeout) |
| 13 | 7,028 NO_SPREADS_RENDERED events | T-03 |
| 14 | 336 dead-lettered outbox | 84.1 |
| 15 | No outbox activity in 45h | Resolves with T-02 |
| 16 | Cron borrower-reminders 504 | 84.1 (unrelated to propagation — no reminders scheduled) |
| 17 | `/api/admin/spreads/backfill-gcf-facts` 504 | 84.1 (admin tool) |
| 18 | 0 ai_risk_runs for 8/9 deals | Not addressed here — resolves as deals advance |
| 19 | `deal_decisions` empty | T-08 |
| 20 | `agent_approval_events` empty | T-08 |
| 21 | `agent_skill_evolutions` empty | 84.1 (depends on T-04) |
| 22 | `extraction_correction_log` empty | 84.1 (depends on T-04) |
| 23 | `canonical_action_executions` empty | T-08 |
| 24 | `draft_borrower_requests` empty | T-08 |
| 25 | `borrower_request_campaigns` empty | T-08 |
| 26 | Samaritus deleted | 84.1 (not blocking) |
| 27 | 4 duplicate Ellmann deals | T-06 |
| 28 | ChatGPT Fix 11-15 in prod | T-10 |
| 29 | `ownership_entities` weak linking | Resolves with T-02 |
| 30 | Memory file outdated | T-09 |
| 31 | `.env.example` stale | T-09 |
| 32 | 125+ root markdown files | T-10 |

---

**End of spec v2.**
