# Phase 84 — System Audit Remediation

**Status:** Draft for Claude Code / Antigravity execution
**Authored:** 2026-04-17 (Claude Opus 4.7 audit)
**Predecessors:** Phase 79 (God Tier Closure) — architecturally complete but 43/43 Omega calls fail live; Phases 72–75 (workflows / governance) — infrastructure shipped but empty tables
**Scope:** 37 discrete findings across 6 subsystems; 10 executable tickets organized into 4 waves
**Guardrail:** Every ticket ships with pre-work SQL verification, exact file paths, and a post-deploy acceptance check. Antigravity MUST run the pre-work query before touching code.

---

## Orientation

This spec exists because a full audit on April 17 revealed a gap between architectural intent and production reality. The code for many declared systems is present, compiles, and passes guards — but the tables those systems write to are empty, the remote services they call return `Method not found`, and one foundational subsystem (the document classifier) has a 100% live failure rate while a parallel extraction path writes facts without recording runs.

The audit also found a GLBA compliance wall violation: 82 public tables with tenant columns have RLS disabled. This is the single finding with the highest regulatory consequence.

This phase does not introduce new features. It closes the gap between *"shipped"* and *"working in production against live tenants"*.

**Memory & recency:** Before executing any ticket, Antigravity reads this spec end-to-end, then verifies `BUDDY_PROJECT_ROADMAP.md` reflects a post-Phase-79 state. If the roadmap still shows Phase 79 as current, this spec belongs on top of it.

---

## Root-cause storyline (read before ticketing)

The findings are not independent. They fall out of a small number of root causes:

```
ROOT CAUSE 1 — Document classifier has no OCR text/image on the text path.
  Evidence: 44/44 DOC_GATEKEEPER_CLASSIFY_FAILED events in 7 days,
            all with review_reason_code=NO_OCR_OR_IMAGE,
            Gemini classifier returned null on text path.
  Downstream consequences:
    - Documents route to NEEDS_REVIEW with doc_type=UNKNOWN
    - Parallel extractor path (gemini_primary_v1) writes facts anyway
      but uses 10 different extractor signatures, none of which call
      runRecord.ts. deal_extraction_runs stays empty permanently.
    - extraction_correction_log stays empty (no runs to correct)
    - agent_skill_evolutions stays empty (no corrections to stage)

ROOT CAUSE 2 — Omega MCP protocol mismatch.
  Evidence: 43/43 omega.invoked events paired with 43/43 omega.failed,
            all returning omega_rpc_error: Method not found.
  Buddy sends JSON-RPC with methods like omega://confidence/evaluate.
  Pulse MCP at pulse-mcp-651478110010.us-central1.run.app exposes
  tool-style methods (buddy_ledger_*, memory_*, action_*, trigger_upsert)
  and does NOT implement the omega:// URI scheme.
  Downstream: omegaAdvisory is always null in underwrite/state responses.

ROOT CAUSE 3 — Checklist state machine terminates at "received".
  Evidence: 1,076 items "missing", 180 items "received", 0 items at
            "satisfied" or any downstream status. checklist_item_matches
            has 17 auto_applied matches but those never propagate to flip
            the source checklist item's status.
  Downstream: readiness = 0% on every deal, committee gate unreachable,
              deal_decisions empty, canonical_action_executions empty.

ROOT CAUSE 4 — RLS disabled on tenant-bearing tables.
  82 public tables with deal_id / bank_id / borrower_id columns have
  RLS disabled. This is a GLBA violation regardless of whether any
  caller actually abuses it — it is the absence of the second defense
  wall. Supabase security advisor reports 129 ERROR-level findings.

ROOT CAUSE 5 — Observer watchdog lacks dedup / cooldown.
  7,028 NO_SPREADS_RENDERED critical events in 48 hours all carry
  observer_decision=job_marked_dead. Actual spread rendering is healthy
  (14/14 jobs SUCCEEDED, 34 spread_runs). The observer is re-flagging the
  same already-dead stale jobs every few seconds.

ROOT CAUSE 6 — No idempotency guard on deal creation.
  Four "Ellmann & Elmann Part 2" deals created on the same day; two have
  facts, two are empty shells. User retries produce duplicate deals.

The remaining findings are housekeeping (stale .env.example, 125+ root
markdown files, empty governance tables that depend on #1–#3 resolving).
```

**Waves are ordered by dependency, not by priority number.** Fixing Root Cause 1 (classifier OCR) unblocks Root Causes 3, governance table population, and most empty-table findings. Fix 4 (RLS) is parallel-safe and should ship first because it carries the highest regulatory downside.

---

## Wave structure

| Wave | Goal | Tickets | Gates before next wave |
|---|---|---|---|
| 0 | Safety fence — RLS wall up | T-01 | RLS migration passes, no regressions in integration test |
| 1 | Stop the bleeding — fix classifier + observer noise | T-02, T-03 | 10 successful classifications logged in 24h |
| 2 | Close the truth loop — runs, checklist, idempotency | T-04, T-05, T-06 | Checklist flips at least 1 deal to ≥50% satisfied |
| 3 | Restore advisory + governance | T-07, T-08 | Omega returns a non-null advisory at least once |
| 4 | Housekeeping + memory + hygiene | T-09, T-10 | Roadmap updated, .env.example complete, test deals archived |

---

## Wave 0 — Safety fence

### T-01 — Enable RLS on the 32 worst cross-tenant tables

**Finding reference:** Root Cause 4. Audit advisor output lists 129 ERROR-level RLS findings. Highest-risk subset is the 32 tables with both `deal_id` AND `bank_id` columns exposed without RLS, plus `document_ocr_words` and `document_ocr_page_map` which carry `deal_id` and expose raw OCR content.

**Why this ticket first:**
RLS migrations are additive and non-breaking when the app uses `supabaseAdmin()` (service role) everywhere. Service-role bypasses RLS, so current traffic is unaffected. The migration adds a defense wall — it does not remove any existing functionality. This is the safest possible first ticket.

**Pre-work (Antigravity MUST run this):**
```sql
-- Confirm RLS is still disabled on the target tables
SELECT 
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  COUNT(p.policyname) as policy_count
FROM pg_class c
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE c.relname IN (
  'deal_financial_facts','deal_spreads','canonical_memo_narratives',
  'credit_memo_drafts','credit_memo_snapshots','credit_memo_citations',
  'document_artifacts','document_ocr_words','document_ocr_page_map',
  'deal_truth_events','deal_upload_sessions','deal_upload_session_files',
  'deal_spread_runs','deal_spread_jobs','deal_rent_roll_rows',
  'deal_monitoring_programs','deal_monitoring_obligations',
  'deal_monitoring_cycles','deal_monitoring_exceptions',
  'deal_annual_reviews','deal_renewal_prep',
  'deal_annual_review_cases','deal_renewal_cases',
  'deal_review_case_requirements','deal_review_case_exceptions',
  'deal_review_case_outputs','deal_watchlist_cases',
  'deal_workout_cases','deal_workout_events','deal_workout_action_items',
  'pricing_scenarios','pricing_decisions','deal_pricing_quotes',
  'deal_pricing_inputs','rate_index_snapshots',
  'financial_review_resolutions','builder_decisions',
  'checklist_item_matches','deal_entities','entity_relationships',
  'deal_flags','deal_flag_audit','deal_flag_send_packages',
  'deal_borrower_questions','deal_committee_decisions',
  'deal_loan_decisions','deal_distribution_snapshots',
  'deal_distribution_actions','deal_credit_memo_status',
  'deal_decision_finalization','deal_policy_exceptions',
  'deal_structuring_selections','deal_structuring_freeze',
  'structuring_recommendation_snapshots','banker_queue_snapshots',
  'banker_focus_sessions','banker_queue_acknowledgements',
  'buddy_research_quality_gates','buddy_covenant_packages',
  'buddy_borrower_reports','buddy_validation_reports',
  'memo_runs','risk_runs','borrower_owner_attestations'
)
AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
```
Expected: most rows show `rls_enabled=false, policy_count=0`. Any row showing `rls_enabled=true` should be removed from the migration scope.

**Implementation:**

Create `supabase/migrations/20260418_phase_84_rls_tenant_wall.sql` with content:

```sql
-- Phase 84 T-01 — Tenant isolation wall
-- 
-- Enables RLS on cross-tenant tables. Policies are permissive for
-- service_role (which is what supabaseAdmin() uses) — no runtime impact.
-- The goal is defense-in-depth: if any future code path uses the anon key,
-- tenant data cannot leak.

BEGIN;

-- Helper: tenant_id extraction from JWT claims (Clerk → bank_id cookie → session)
-- Service-role bypasses all policies, so these policies only fire for anon/authenticated roles.

DO $$
DECLARE
  t text;
  tables_with_deal_and_bank text[] := ARRAY[
    'deal_financial_facts','deal_spreads','canonical_memo_narratives',
    'credit_memo_drafts','credit_memo_snapshots',
    'document_artifacts','deal_truth_events','deal_upload_sessions',
    'deal_upload_session_files','deal_spread_runs','deal_spread_jobs',
    'deal_rent_roll_rows','deal_monitoring_programs',
    'deal_monitoring_obligations','deal_monitoring_cycles',
    'deal_monitoring_exceptions','deal_annual_reviews','deal_renewal_prep',
    'deal_annual_review_cases','deal_renewal_cases',
    'deal_review_case_requirements','deal_review_case_exceptions',
    'deal_review_case_outputs','deal_watchlist_cases',
    'deal_workout_cases','pricing_scenarios','pricing_decisions',
    'deal_pricing_quotes','rate_index_snapshots',
    'financial_review_resolutions','builder_decisions',
    'checklist_item_matches','banker_queue_snapshots',
    'banker_focus_sessions','banker_queue_acknowledgements'
  ];
  tables_with_deal_only text[] := ARRAY[
    'credit_memo_citations','deal_borrower_questions','deal_committee_decisions',
    'deal_credit_memo_status','deal_decision_finalization',
    'deal_distribution_actions','deal_distribution_snapshots',
    'deal_entities','entity_relationships','deal_flag_audit',
    'deal_flag_send_packages','deal_flags','deal_loan_decisions',
    'deal_policy_exceptions','deal_pricing_inputs',
    'deal_structuring_freeze','deal_structuring_selections',
    'deal_watchlist_events','deal_workout_action_items',
    'deal_workout_events','document_ocr_page_map','document_ocr_words',
    'memo_runs','risk_runs','structuring_recommendation_snapshots',
    'buddy_borrower_reports','buddy_covenant_packages',
    'buddy_research_quality_gates','buddy_validation_reports'
  ];
BEGIN
  -- Tables with BOTH deal_id and bank_id: bank_id predicate
  FOREACH t IN ARRAY tables_with_deal_and_bank LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (bank_id::text = COALESCE(current_setting(''request.jwt.claims'', true)::jsonb->>''bank_id'', '''')) WITH CHECK (bank_id::text = COALESCE(current_setting(''request.jwt.claims'', true)::jsonb->>''bank_id'', ''''));',
      'phase84_' || t || '_tenant_scope', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'phase84_' || t || '_service_role', t
    );
  END LOOP;

  -- Tables with ONLY deal_id: scope via deals.bank_id lookup
  FOREACH t IN ARRAY tables_with_deal_only LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.deals d WHERE d.id = %I.deal_id AND d.bank_id::text = COALESCE(current_setting(''request.jwt.claims'', true)::jsonb->>''bank_id'', '''')));',
      'phase84_' || t || '_tenant_scope', t, t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'phase84_' || t || '_service_role', t
    );
  END LOOP;
END$$;

COMMIT;
```

**Note on `borrower_owner_attestations`**: Uses `borrower_id`, not `deal_id`. Left for a T-01-B follow-up so we can scope via borrower→deal→bank lookup in a separate, narrower migration.

**Also out of scope for this migration but flagged for follow-up:**
- 46 `security_definer_view` ERROR findings — need per-view review
- 88 `function_search_path_mutable` WARN findings — bulk fix via `ALTER FUNCTION ... SET search_path = public, pg_temp`
- 39 `rls_policy_always_true` findings — audit whether service_role-only policies can be tightened
- `vector` extension in public schema — move to dedicated `extensions` schema

These become Phase 84.1 after this wave's acceptance gate passes.

**Post-deploy acceptance:**
1. Run the pre-work query again. Every target table returns `rls_enabled=true, policy_count=2`.
2. Supabase advisor `rls_disabled_in_public` count drops by ≥ 62.
3. Smoke test: `/api/deals/[dealId]/underwrite/state` returns a 200 with non-empty body for a deal owned by the caller's bank. This confirms service-role path is unaffected.
4. Emit a canonical ledger event `phase.84.t01.completed` via `writeEvent()`.

**Rollback:** Single transaction — revert with `DROP POLICY phase84_*` followed by `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`.

---

## Wave 1 — Stop the bleeding

### T-02 — Document classifier OCR text/image feed

**Finding reference:** Root Cause 1. 44/44 DOC_GATEKEEPER_CLASSIFY_FAILED events with `reasons: ["Gemini classifier returned null on text path"]`, `input_path: "no_ocr_no_image"`. 

**Why this matters:**
Every uploaded document goes to `doc_type: UNKNOWN` and lands in NEEDS_REVIEW. A parallel extractor path (`gemini_primary_v1`) happens to write facts anyway — which is why facts exist despite classification failure. But that parallel path masks the fact that the canonical classifier is broken, and every downstream system (checklist match, review queue, SR 11-7 audit trail) depends on the canonical path working.

**Pre-work:**
```sql
-- Sample 3 recent failures to confirm shape
SELECT 
  created_at,
  payload->'input'->>'document_id' as document_id,
  payload->'input'->>'input_path' as input_path,
  payload->'input'->>'review_reason_code' as reason,
  payload->'input'->>'latency_ms' as latency_ms
FROM deal_events
WHERE kind = 'DOC_GATEKEEPER_CLASSIFY_FAILED'
ORDER BY created_at DESC
LIMIT 3;

-- Then: for one of those document_ids, check whether OCR text or structured JSON exists
SELECT 
  (SELECT extracted_text IS NOT NULL FROM document_ocr_results WHERE attachment_id = '<documentId>') as has_ocr,
  (SELECT fields_json IS NOT NULL FROM document_extracts WHERE attachment_id = '<documentId>' AND status = 'SUCCEEDED') as has_extracts,
  (SELECT status FROM document_extracts WHERE attachment_id = '<documentId>') as extracts_status;
```

**Three likely causes in priority order (Antigravity diagnoses before coding):**

1. **`USE_GEMINI_OCR=false` in Vercel production env.**
   - The default in `.env.example` is `false`. If this was never flipped in Vercel settings, Gemini OCR never runs, and the classifier sees an empty document every time.
   - Diagnostic: Check Vercel project env vars. If `false` or unset, flip to `true` for Production and Preview environments.
   - Fix: change the env var. No code change.

2. **`GEMINI_OCR_MODEL=gemini-2.0-flash-exp` has been deprecated.**
   - `-exp` suffixes expire. Current supported model tags should be verified against Google Cloud docs.
   - Diagnostic: Check Vercel env var value.
   - Fix: update to a current GA model tag (likely `gemini-2.0-flash-001` or equivalent). Update `.env.example` to match.

3. **The classifier is being invoked *before* OCR completes, with no retry.**
   - Possible race: upload triggers classifier immediately; OCR job queued but not complete.
   - Diagnostic: trace the classifier call site in `src/lib/classification/` — does it wait for `document_ocr_results` row or does it proceed on empty?
   - Fix: add a precondition: if OCR text is empty AND document_extracts.status != 'SUCCEEDED', requeue the classifier with a 30s delay. Cap retries at 3.

**Implementation sequence:**

**Step 1 — Diagnose the env (Antigravity does this first, as a read-only check).**
```
Read Vercel project env vars for:
  - USE_GEMINI_OCR
  - GEMINI_OCR_MODEL  
  - GEMINI_API_KEY presence
  - GOOGLE_CLOUD_PROJECT presence
```
Report findings back before writing any code.

**Step 2 — If env is the cause:**
- Update Vercel env: `USE_GEMINI_OCR=true`, `GEMINI_OCR_MODEL=<current supported tag>`
- Update `.env.example` to reflect the corrected defaults
- Emit test document upload; watch for `classification.decided` in `deal_events`
- No code changes needed

**Step 3 — If env is correct but failures continue:**
- Locate the classifier invocation site. The audit found it references `document_ocr_results.extracted_text` fallback to `document_extracts.fields_json.extractedText`. Both are null on the failing path.
- Add a precondition guard in whichever route/job calls `classifyWithGemini`:
  ```typescript
  // Before calling the classifier:
  const [ocrRow, extractsRow] = await Promise.all([
    sb.from("document_ocr_results").select("extracted_text").eq("attachment_id", documentId).maybeSingle(),
    sb.from("document_extracts").select("fields_json, status").eq("attachment_id", documentId).eq("status","SUCCEEDED").maybeSingle(),
  ]);
  const hasText = Boolean(ocrRow.data?.extracted_text) || Boolean(extractsRow.data?.fields_json?.extractedText);
  if (!hasText) {
    // Requeue classify job with exponential backoff. Cap at 3 retries.
    await requeueClassify(documentId, { attempt: (prevAttempt ?? 0) + 1, maxAttempts: 3 });
    return { ok: false, reason: "awaiting_ocr" };
  }
  ```

**Post-deploy acceptance:**
1. Upload a test PDF to a test deal.
2. Within 60 seconds, `deal_events` contains `classification.decided` for that `document_id` with `doc_type != UNKNOWN` and `confidence > 0`.
3. Over 24 hours, `DOC_GATEKEEPER_CLASSIFY_FAILED` count drops to < 5% of attempts (was 100%).
4. `document_ocr_results.extracted_text IS NOT NULL` for newly-uploaded docs.

### T-03 — Observer dedup / cooldown

**Finding reference:** Root Cause 5. 7,028 `NO_SPREADS_RENDERED` critical events in 48 hours all carry `observer_decision: job_marked_dead` for the same stale jobs, not new failures. Actual spread rendering is healthy (14/14 jobs SUCCEEDED). This is observer noise, not a spreads problem.

**Implementation:**

Locate `src/lib/observer/` or `/api/workers/observer/` (whichever runs the `NO_SPREADS_RENDERED` check). Add a simple dedup key:

```typescript
// In the observer's spread check function:
const dedupKey = `obs:spread:${dealId}:${jobId}:${observer_decision}`;
const lastFiredMs = await observerLastFired(dedupKey);
const FIVE_MIN_MS = 5 * 60 * 1000;
if (lastFiredMs && Date.now() - lastFiredMs < FIVE_MIN_MS) {
  return; // Skip — we already flagged this within the cooldown window
}
await observerMarkFired(dedupKey);
// ... then emit the critical event
```

Storage for dedup can be a simple in-memory Map within the observer process (observers are long-running) OR an `observer_dedup` table with `(key text PK, last_fired_at timestamptz)`. Memory is faster; table survives restarts. For this fix, use a table — the observer restart cadence is part of the problem.

**Migration:**
```sql
CREATE TABLE IF NOT EXISTS public.observer_dedup (
  key text PRIMARY KEY,
  last_fired_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.observer_dedup ENABLE ROW LEVEL SECURITY;
CREATE POLICY observer_dedup_service_role ON public.observer_dedup
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Apply cooldown windows tuned per check:
- `NO_SPREADS_RENDERED` → 5 min
- `stuck_job` → 30 min  
- generic heartbeat alerts → 5 min

**Post-deploy acceptance:**
1. `buddy_system_events` with `severity='critical'` drops below 200 per 24h (was 7,028 in 48h → roughly 150 per 24h ceiling).
2. No single dedup key fires more than once per its cooldown window.
3. Genuine new failures (different `job_id` or `deal_id`) still fire immediately.

---

## Wave 2 — Close the truth loop

### T-04 — Resolve the `deal_extraction_runs` ghost

**Finding reference:** Finding #4. `runRecord.ts` exports `createExtractionRun` / `finalizeExtractionRun` and looks production-grade but is dead code — not re-exported from `index.ts`, not called by any of the 10 extractor paths writing facts. `deal_extraction_runs` permanently empty.

**Decision required (Antigravity does NOT decide this — product/architect decides):**
Either (A) wire the 10 extractor paths through `runRecord.ts`, or (B) delete `runRecord.ts` and update the roadmap to match reality.

**Recommended: Option A, but staged.** Wire the highest-volume extractor (`gemini_primary_v1`, 1,028 facts, 63 docs) first. Every other extractor becomes a follow-up as time permits.

**Pre-work:**
```sql
-- Confirm which extractors are active
SELECT 
  provenance->>'extractor' as extractor,
  COUNT(*) as facts,
  COUNT(DISTINCT source_document_id) as docs,
  MAX(created_at)::date as latest
FROM deal_financial_facts
WHERE fact_type != 'EXTRACTION_HEARTBEAT'
  AND created_at > NOW() - INTERVAL '14 days'
GROUP BY 1
ORDER BY facts DESC;
```

**Implementation sequence:**

**Step 1 — Re-export the run primitives from the extraction barrel:**

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

**Step 2 — Wire `gemini_primary_v1` through the run ledger:**

Locate the call site — likely `src/lib/financialSpreads/extractors/gemini/geminiDocumentExtractor.ts` (the `extractWithGeminiPrimary` function called from `extractFactsFromDocument.ts`). Wrap:

```typescript
import { createExtractionRun, finalizeExtractionRun, markRunRunning } from "@/lib/extraction";

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
    // Idempotent short-circuit
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

**Step 3 — Add a follow-up ticket stub to the roadmap** for wiring the other 9 extractors (`personalIncomeExtractor`, `materializeFactsFromArtifacts`, `extractFactsFromDocument:v5`, `gemini_primary_schedule_detect`, `backfillCanonicalFactsFromSpreads`, `persistGlobalCashFlow`). Don't do them all in this ticket — scope creep.

**Post-deploy acceptance:**
1. Within 2 hours of deploy, `deal_extraction_runs` has ≥ 1 row with `status='succeeded'`.
2. Within 24 hours, `deal_extraction_runs` row count matches `gemini_primary_v1` documents processed in that window (+/- 10%).
3. `deal_extraction_runs.cost_usd` is non-null for ≥ 50% of new rows.
4. Operator console (`/ops/agents`) shows a non-empty `document_extraction` workflow row count.

### T-05 — Checklist state machine wire-through

**Finding reference:** Root Cause 3. 1,076 items `missing`, 180 items `received`, zero items `satisfied`. `checklist_item_matches` shows 17 `auto_applied` matches but those never propagate to flip the source item's status.

**Pre-work:**
```sql
-- Confirm: matches exist but items stuck at "received"
SELECT 
  (SELECT COUNT(*) FROM checklist_item_matches WHERE status='auto_applied') as auto_applied_matches,
  (SELECT COUNT(DISTINCT checklist_item_id) FROM checklist_item_matches WHERE status='auto_applied') as matched_items,
  (SELECT COUNT(*) FROM deal_checklist_items WHERE status='satisfied') as satisfied_items,
  (SELECT COUNT(*) FROM deal_checklist_items WHERE status='received') as received_items;

-- Sample a matched item that's stuck at "received"
SELECT dci.id, dci.status, dci.requirement_code, cim.status as match_status, cim.document_id
FROM deal_checklist_items dci
JOIN checklist_item_matches cim ON cim.checklist_item_id = dci.id
WHERE cim.status = 'auto_applied' AND dci.status = 'received'
LIMIT 3;
```

**Implementation:**

Locate the reconciliation function that runs after `checklist_item_matches` is written. Likely in `src/lib/checklist/` or `src/lib/deal_document/`. The function that fires on `checklist.reconciled` events is the integration point.

Add a post-match status promotion step:

```typescript
// After a checklist_item_matches row is written with status='auto_applied':
async function promoteChecklistItemStatus(itemId: string, dealId: string, bankId: string) {
  const sb = supabaseAdmin();
  
  // Read the current item
  const { data: item } = await sb
    .from("deal_checklist_items")
    .select("id, status, requirement_code, deal_id")
    .eq("id", itemId)
    .maybeSingle();
    
  if (!item) return;
  if (item.status === "satisfied" || item.status === "waived") return; // already terminal
  
  // Check the match meets the satisfaction criteria:
  //  - At least one auto_applied or banker_approved match exists
  //  - That match's document has doc_type != UNKNOWN
  //  - That document has extraction_quality_status != "SUSPECT" (from D1 gate)
  const { data: qualifyingMatches } = await sb
    .from("checklist_item_matches")
    .select("document_id, deal_documents!inner(ai_doc_type, extraction_quality_status)")
    .eq("checklist_item_id", itemId)
    .in("status", ["auto_applied", "banker_approved"]);
    
  const satisfied = (qualifyingMatches ?? []).some((m: any) =>
    m.deal_documents?.ai_doc_type && 
    m.deal_documents.ai_doc_type !== "UNKNOWN" &&
    m.deal_documents.extraction_quality_status !== "SUSPECT"
  );
  
  if (satisfied) {
    await sb
      .from("deal_checklist_items")
      .update({ 
        status: "satisfied", 
        satisfied_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", itemId);
      
    await writeEvent({
      dealId,
      kind: "checklist.item_satisfied",
      scope: "checklist",
      action: "item_satisfied",
      meta: { item_id: itemId, requirement_code: item.requirement_code },
    });
  }
}
```

Wire this into the point where `checklist_item_matches` INSERT completes — either a Postgres trigger or a post-insert hook in the match-application code.

**Backfill migration (run once after deploy):**
```sql
-- Backfill: promote items that already have qualifying matches
UPDATE deal_checklist_items dci
SET status = 'satisfied', satisfied_at = now(), updated_at = now()
WHERE status = 'received'
  AND EXISTS (
    SELECT 1 FROM checklist_item_matches cim
    JOIN deal_documents dd ON dd.id = cim.document_id
    WHERE cim.checklist_item_id = dci.id
      AND cim.status IN ('auto_applied','banker_approved')
      AND COALESCE(dd.ai_doc_type,'UNKNOWN') <> 'UNKNOWN'
      AND COALESCE(dd.extraction_quality_status,'') <> 'SUSPECT'
  );
```

**Post-deploy acceptance:**
1. After backfill, at least one deal has ≥ 1 item at `status='satisfied'`.
2. Uploading a new document to an existing deal flips the corresponding checklist item to `satisfied` within 2 minutes.
3. `ReadinessPanel` for that deal shows a percentage > 0%.
4. A `checklist.item_satisfied` event appears in `deal_events` for each flipped item.

### T-06 — Deal creation idempotency guard

**Finding reference:** Root Cause 6. Four duplicate "Ellmann & Elmann Part 2" deals on April 15 — two with facts, two empty shells.

**Implementation:**

Two-layer defense:

**Layer 1 — Idempotency key header in `/api/deals/create`:**

```typescript
// Accept optional Idempotency-Key header from the client
const idempotencyKey = req.headers.get("idempotency-key");

if (idempotencyKey) {
  // Check if this key has been seen in the last 24 hours
  const { data: prior } = await sb
    .from("deal_creation_idempotency")
    .select("deal_id, created_at")
    .eq("key", idempotencyKey)
    .eq("bank_id", bankId)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .maybeSingle();
    
  if (prior?.deal_id) {
    // Return the already-created deal
    return NextResponse.json({ ok: true, deal_id: prior.deal_id, reused: true });
  }
  
  // Will insert after creation succeeds
}
```

**Layer 2 — Time-window uniqueness guard (fallback for clients without the header):**

```sql
CREATE TABLE IF NOT EXISTS public.deal_creation_idempotency (
  key text NOT NULL,
  bank_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, bank_id)
);
ALTER TABLE public.deal_creation_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY dci_service_role ON public.deal_creation_idempotency
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Prevent duplicate-name creation within 60 seconds per bank
CREATE OR REPLACE FUNCTION public.check_duplicate_deal_creation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM deals 
    WHERE bank_id = NEW.bank_id 
      AND lower(trim(name)) = lower(trim(NEW.name))
      AND created_at > now() - interval '60 seconds'
      AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'duplicate_deal_within_window: a deal with this name was just created (within 60s)'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_duplicate_deal ON deals;
CREATE TRIGGER trg_check_duplicate_deal
  BEFORE INSERT ON deals
  FOR EACH ROW
  EXECUTE FUNCTION check_duplicate_deal_creation();
```

**Cleanup of existing duplicates:**

Don't delete user data without confirmation. Instead, flag:

```sql
-- Add a column if it doesn't exist (safe additive change)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES deals(id);

-- Flag the two empty duplicates as duplicates of the real ones
-- (Actual UUIDs substituted at runtime from pre-work query)
UPDATE deals SET duplicate_of = (
  SELECT id FROM deals 
  WHERE name = 'Ellmann & Elmann Part 2' 
    AND id IN (SELECT deal_id FROM deal_financial_facts GROUP BY deal_id HAVING COUNT(*) > 100)
  ORDER BY created_at ASC LIMIT 1
)
WHERE name = 'Ellmann & Elmann Part 2'
  AND id IN (
    SELECT d.id FROM deals d 
    LEFT JOIN deal_financial_facts dff ON dff.deal_id = d.id 
    GROUP BY d.id 
    HAVING COUNT(dff.id) = 0
  );
```

Banker can later decide to delete the flagged duplicates via UI. Do not bulk-delete in this migration.

**Post-deploy acceptance:**
1. Attempting to POST `/api/deals/create` twice in 60 seconds with the same `name` + `bank_id` returns 409 on the second attempt.
2. Attempting with an `Idempotency-Key` header twice returns `reused: true` on the second call.
3. The four Ellmann duplicates: the two empty shells have `duplicate_of` set pointing to a real sibling.

---

## Wave 3 — Restore advisory + governance

### T-07 — Omega protocol mismatch

**Finding reference:** Root Cause 2. 43/43 Omega invocations fail with `omega_rpc_error: Method not found`. Buddy sends JSON-RPC methods like `omega://confidence/evaluate`; Pulse MCP exposes tool-style methods (`buddy_ledger_list`, `memory_search`, `action_execute`, etc.).

**Decision required:** Choose ONE:

**Option A — Rewrite Buddy to call Pulse's actual tool surface.**
Cheaper. Pulse tools already exist. Buddy's `invokeOmega` becomes a thin translator.

**Option B — Add `omega://` resource handlers to Pulse.**
Cleaner conceptual separation. Pulse stays tool-based for other clients; adds an RPC dispatcher for Buddy's resource-style calls.

**Recommendation: Option A.** Fewer moving parts, no coordinated deploy across two codebases. Pulse tools already exist in production and are stable.

**Pre-work (Antigravity confirms):**
```sql
-- Confirm the exact resource strings Buddy is calling
SELECT DISTINCT payload->>'resource' as resource, COUNT(*) 
FROM buddy_signal_ledger
WHERE type = 'omega.invoked'
GROUP BY 1
ORDER BY 2 DESC;
```

Expected resources based on audit:
- `omega://confidence/evaluate`
- `omega://state/underwriting_case/{dealId}`
- `omega://traces/{dealId}`
- `omega://events/write`
- `omega://advisory/deal-focus`

**Implementation:**

Create `src/lib/omega/pulseAdapter.ts`:

```typescript
import "server-only";
import type { OmegaResult } from "./invokeOmega";

/**
 * Map Buddy's omega:// resource URIs to Pulse MCP tool calls.
 * 
 * This adapter exists because Pulse MCP exposes tool-style methods
 * (buddy_ledger_*, memory_*, action_*) rather than the omega:// URI
 * scheme Buddy originally designed for. Until Pulse adds native
 * omega:// handlers, this adapter translates.
 */
export type ResourceMapping = {
  pulseToolName: string;
  buildParams: (payload: unknown, uri: string) => Record<string, unknown>;
  mapResponse: (raw: unknown) => unknown;
};

const RESOURCE_MAP: Record<string, ResourceMapping> = {
  "omega://events/write": {
    pulseToolName: "buddy_ledger_write",
    buildParams: (p: any) => ({
      event_type: p?.kind ?? "unknown",
      status: p?.status ?? "success",
      deal_id: p?.dealId,
      payload: p,
    }),
    mapResponse: (r: any) => ({ ok: true, written: r }),
  },
  "omega://confidence/evaluate": {
    pulseToolName: "memory_search",
    buildParams: (p: any) => ({
      query: `confidence ${p?.dealId ?? ""} ${p?.dimension ?? ""}`.trim(),
      limit: 10,
    }),
    mapResponse: (r: any) => ({
      confidence: 50, // Default until Pulse provides native confidence scoring
      signals: Array.isArray(r) ? r.map((x: any) => x?.content ?? "").slice(0, 5) : [],
    }),
  },
  // Pattern match for /omega:\/\/state\/underwriting_case\/[uuid]/
  // and /omega:\/\/traces\/[uuid]/ handled by a regex in the caller.
};

// Also match pattern URIs
export function resolveResourceMapping(uri: string): ResourceMapping | null {
  if (RESOURCE_MAP[uri]) return RESOURCE_MAP[uri];
  
  if (/^omega:\/\/state\/underwriting_case\/[0-9a-f-]+$/i.test(uri)) {
    const dealId = uri.split("/").pop()!;
    return {
      pulseToolName: "buddy_ledger_deal",
      buildParams: () => ({ deal_id: dealId, limit: 50 }),
      mapResponse: (r: any) => ({ deal_id: dealId, events: r }),
    };
  }
  
  if (/^omega:\/\/traces\/[0-9a-f-]+$/i.test(uri)) {
    const dealId = uri.split("/").pop()!;
    return {
      pulseToolName: "buddy_ledger_list",
      buildParams: () => ({ deal_id: dealId, hours: 168, limit: 200 }),
      mapResponse: (r: any) => ({ deal_id: dealId, traces: r }),
    };
  }
  
  if (uri === "omega://advisory/deal-focus") {
    return {
      pulseToolName: "memory_search",
      buildParams: (p: any) => ({ query: `deal ${p?.dealId ?? ""}`, limit: 20 }),
      mapResponse: (r: any) => ({ advisory: r }),
    };
  }
  
  return null;
}
```

Update `src/lib/omega/invokeOmega.ts` — replace the `mcpCall` function body:

```typescript
async function mcpCall<T>(resource: string, payload: unknown): Promise<T> {
  const baseUrl = getOmegaMcpUrl();
  if (!baseUrl) throw new Error("omega_not_connected: OMEGA_MCP_URL not configured");

  const { resolveResourceMapping } = await import("./pulseAdapter");
  const mapping = resolveResourceMapping(resource);
  
  if (!mapping) {
    // Resource not implemented on Pulse — fail fast, don't flood the ledger
    throw new Error(`omega_unsupported_resource: ${resource}`);
  }
  
  const apiKey = getOmegaMcpApiKey();
  const requestId = `buddy-${++_jsonRpcSeq}-${Date.now().toString(36)}`;
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  
  // Translate to tool-call shape
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: {
      name: mapping.pulseToolName,
      arguments: mapping.buildParams(payload ?? {}, resource),
    },
  });

  const response = await fetch(baseUrl, { method: "POST", headers, body });
  if (!response.ok) {
    throw new Error(`omega_http_${response.status}: ${response.statusText || "request failed"}`);
  }
  
  const json = await response.json() as any;
  if (json.error) throw new Error(`omega_rpc_error: ${json.error.message ?? `code ${json.error.code}`}`);
  if (json.result === undefined) throw new Error("omega_rpc_empty: no result in response");
  
  return mapping.mapResponse(json.result) as T;
}
```

**Post-deploy acceptance:**
1. Within 1 hour, `buddy_signal_ledger` shows at least 1 `omega.succeeded` event.
2. `omega.failed / omega.invoked` ratio drops below 50% (was 100%).
3. `/api/deals/[dealId]/underwrite/state` returns a non-null `omegaAdvisory` for at least one deal.
4. If any resource remains unsupported, the error is `omega_unsupported_resource:<uri>` (not `Method not found`) — distinguishable in logs.

### T-08 — Exercise the governance tables (smoke test)

**Finding reference:** Findings #9, #19–#24. Governance tables populated but never exercised — `deal_decisions`, `agent_approval_events`, `agent_skill_evolutions`, `canonical_action_executions`, `draft_borrower_requests`, `borrower_request_campaigns` all at 0 rows.

**Decision note:** These tables shouldn't be populated artificially. The better play is a scripted end-to-end smoke test that exercises each governance path with real data.

**Implementation:**

Create `scripts/phase-84-governance-smoke.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * Phase 84 T-08 — Governance smoke test.
 * 
 * Drives one real deal through the approve → decline → escalate paths,
 * creates a draft borrower request, approves it, and exercises the
 * canonical action execution path. Produces verifiable rows in:
 *   - deal_decisions
 *   - agent_approval_events  
 *   - canonical_action_executions
 *   - draft_borrower_requests
 * 
 * Designed to run against a staging/dev deal only. Hard-fails if deal
 * is not flagged test=true or bank_id is not the staging bank.
 */

const STAGING_BANK_ID = process.env.STAGING_BANK_ID;
const TEST_DEAL_ID = process.argv[2];

if (!STAGING_BANK_ID || !TEST_DEAL_ID) {
  console.error("Usage: tsx scripts/phase-84-governance-smoke.ts <dealId>");
  console.error("Requires STAGING_BANK_ID env var.");
  process.exit(1);
}

// Steps:
// 1. POST /api/deals/{id}/actions with action=approve — should insert into deal_decisions
// 2. POST /api/deals/{id}/draft-borrower-request — should insert into draft_borrower_requests
// 3. POST /api/admin/agent-approvals with approve=true — should insert into agent_approval_events  
// 4. POST /api/deals/{id}/execute-action — should insert into canonical_action_executions
// 5. Verify all 4 rows exist via direct supabase query
```

**Post-deploy acceptance:**
1. After running the script, `deal_decisions` has ≥ 1 row.
2. `agent_approval_events` has ≥ 1 row with `decision='approved'` + valid snapshot.
3. `canonical_action_executions` has ≥ 1 row.
4. `draft_borrower_requests` has ≥ 1 row with non-null `approved_snapshot`.

---

## Wave 4 — Housekeeping + memory

### T-09 — `.env.example` reconciliation + roadmap update

**Implementation:**

**Part A — Update `.env.example`:**

```diff
- # OpenAI Realtime Voice (Step 4)
- OPENAI_API_KEY=sk-...
- 
- # Buddy builder observer (build-mode only)
- BUDDY_BUILDER_MODE=1
- OPENAI_REALTIME_MODEL=gpt-realtime
- OPENAI_REALTIME_VOICE=marin
- OPENAI_REALTIME_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
+ # OpenAI — used only for chatAboutDeal (Gemini migration queued, P3)
+ OPENAI_API_KEY=

- # Mistral OCR (deprecated/disabled)
- # MISTRAL_API_KEY=
- # USE_MISTRAL_OCR=false

# ─── Gemini OCR (Vertex AI) ──────────────────────────────────────────────
GEMINI_SERVICE_ACCOUNT_JSON=
- USE_GEMINI_OCR=false
+ USE_GEMINI_OCR=true
- # Optional: override OCR model
- GEMINI_OCR_MODEL=gemini-2.0-flash-exp
+ # OCR model — use a current supported GA tag
+ GEMINI_OCR_MODEL=gemini-2.0-flash-001

+ # ─── Clerk ───────────────────────────────────────────────────────────────
+ # Local JWT verification key (RSA public key) — eliminates cold-start BAPI calls
+ CLERK_JWT_KEY=

+ # ─── Omega Advisory (Phase 79 / Phase 84) ───────────────────────────────
+ OMEGA_MCP_ENABLED=0
+ OMEGA_MCP_URL=
+ OMEGA_MCP_API_KEY=
+ OMEGA_MCP_TIMEOUT_MS=4000
+ OMEGA_MCP_KILL_SWITCH=0
```

**Part B — Update `BUDDY_PROJECT_ROADMAP.md`:**

Add a "Current State — April 17, 2026" section replacing the outdated "Phase 53A complete + ..." header. Mark shipped phases:
- Phase 57C, 66, 67, 68, 69, 70: shipped
- Phase 71 (A/B/C), 72–74, 75, 78, 79: shipped  
- Phase 80 (lease + credit memo): new extractors live, wiring complete, awaiting live test
- Phase 84: this spec

**Post-deploy acceptance:**
1. `.env.example` contains `OMEGA_MCP_*` and `CLERK_JWT_KEY`.
2. `.env.example` no longer references `OPENAI_REALTIME_*`.
3. `BUDDY_PROJECT_ROADMAP.md` "Last Updated" line shows the current date.

### T-10 — Repo hygiene + test data flagging

**Implementation:**

**Part A — Root markdown archival:**

```bash
mkdir -p docs/archive/phase-pre-84/
git mv AAR_PHASE_*.md docs/archive/phase-pre-84/
git mv PHASE_*_SPEC.md docs/archive/phase-pre-84/
git mv PHASE_*_TICKETS.md docs/archive/phase-pre-84/
git mv PHASE_4_FILES.txt docs/archive/phase-pre-84/
```

Keep at root only: `README.md`, `BUDDY_PROJECT_ROADMAP.md`, `BUDDY_BUILD_RULES.md`, `DEPLOYMENT.md`, `HOTFIX_LOG.md`.

Remove zero-byte artifacts: `funnel`, `node`, `buddy-the-underwriter@0.1.0`.

**Part B — Flag test deals:**

```sql
-- Flag ChatGPT Fix 11-15 and the empty Ellmann duplicates as test data
ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

UPDATE deals SET is_test = true 
WHERE name ILIKE 'ChatGPT Fix%' OR duplicate_of IS NOT NULL;
```

Update dashboard queries to filter `WHERE is_test = false` for production metrics.

**Part C — Sweep `runRecord.ts` if Option B was chosen in T-04:**

If the product decision was to delete `runRecord.ts`, do it now. Otherwise skip this.

**Post-deploy acceptance:**
1. Root directory has ≤ 15 files (currently ~125 markdown files + loose artifacts).
2. Production dashboards show 2 deals (the real Ellmann + real ChatGPT-Fix-N if any are kept), not 9.

---

## Out of scope — Phase 84.1 backlog

These were identified during the audit but deferred to a follow-up phase:

1. **Samaritus deal restoration** — decide whether to recreate, pick a new canonical test deal, or accept the loss. Not blocking any system.
2. **336 dead-lettered outbox replay** — build a replay script with the new Bearer token. Historical audit gap, not a current-state problem.
3. **Re-extraction orchestrator actual retry** — currently simulated. Needs the run-ledger from T-04 first.
4. **Wire 9 other extractors through runRecord.ts** — T-04 only covers `gemini_primary_v1`.
5. **Security definer view audit** — 46 ERROR findings. Per-view review needed.
6. **Function search_path bulk fix** — 88 WARN findings.
7. **`rls_policy_always_true` tightening** — 39 WARN findings where service_role-only policies may be tightenable.
8. **Vector extension schema migration** — move from `public` to `extensions` schema.
9. **Clerk JWT verification migration** — if `CLERK_JWT_KEY` is not yet set in Vercel, set it. Not a code change.

---

## Execution protocol for Antigravity

**Before ANY ticket:**
1. Read this spec end-to-end.
2. Run the pre-work SQL for that ticket.
3. Report pre-work findings in chat before writing code.

**During a ticket:**
1. Only touch files named in the ticket's Implementation section.
2. If a file path is ambiguous, ask — do not guess.
3. Write the migration / code changes.
4. Commit with message `Phase 84 T-NN — <title>`.

**After a ticket:**
1. Run the post-deploy acceptance checks as SQL queries.
2. Emit an `AAR_PHASE_84_T0N.md` file in `docs/archive/phase-84/` with:
   - Pre-work results
   - Files changed (with line counts)
   - Acceptance results (SQL output)
   - Deviations from spec with rationale

**Phantom commit mitigation:**
After every AAR, verify the committed files exist on `origin/main` via GitHub API read at `ref: main`. Do NOT trust reported SHAs alone.

---

## Success criteria for the phase as a whole

| Criterion | Pre-Phase-84 | Target |
|---|---|---|
| RLS-disabled public tables (tenant-bearing) | 82 | < 5 |
| 24h `DOC_GATEKEEPER_CLASSIFY_FAILED` rate | ~100% | < 5% |
| 24h `NO_SPREADS_RENDERED` critical events | ~3,500 | < 100 |
| `deal_extraction_runs` row count | 0 | ≥ 10 in 7 days |
| Deals with ≥ 1 satisfied checklist item | 0 | ≥ 5 |
| `omega.succeeded` / `omega.invoked` ratio | 0% | ≥ 50% |
| `deal_decisions` row count | 0 | ≥ 1 |
| Duplicate deal creations (same name, same bank, <60s apart) | yes | blocked |
| `.env.example` completeness | partial | matches Vercel prod |

When all 9 success criteria hold for 72 hours, Phase 84 is closed and Phase 84.1 (backlog above) begins.

---

## Appendix — Full findings → ticket crosswalk

| # | Finding | Addressed by |
|---|---|---|
| 1 | 82 tables RLS disabled (GLBA wall) | T-01 |
| 2 | Document classifier 100% failing | T-02 |
| 3 | Checklist stuck at "received" | T-05 |
| 4 | `deal_extraction_runs` empty | T-04 |
| 5 | Re-extraction orchestrator simulated | 84.1 (depends on T-04) |
| 6 | Material drift detected 11×/7d | Resolves with T-02 + T-04 |
| 7 | Reconciliation runs on bad data | Resolves with T-02 |
| 8 | Omega 100% failing live | T-07 |
| 9 | Phase 80 lease/credit memo no facts | Resolves with T-02 |
| 10 | Output contracts half-wired | 84.1 |
| 11 | `runRecord.ts` dead code | T-04 |
| 12 | Spreads worker dying every 30 min | T-03 (observer noise, not real failure) |
| 13 | 7,028 NO_SPREADS_RENDERED events/48h | T-03 |
| 14 | 336 dead-lettered outbox (HTTP 401) | 84.1 |
| 15 | No outbox activity in 45h | Resolves with T-02 (uploads resume) |
| 16 | Cron borrower-reminders 504 | Resolves with T-05 (schedule populates) |
| 17 | `/api/admin/spreads/backfill-gcf-facts` 504 | Out of scope — admin-only tool, bump maxDuration separately |
| 18 | 0 ai_risk_runs for 8/9 deals | Resolves with T-05 (committee gate unblocks risk run) |
| 19 | `deal_decisions` empty | T-08 |
| 20 | `agent_approval_events` empty | T-08 |
| 21 | `agent_skill_evolutions` empty | 84.1 (depends on T-04) |
| 22 | `extraction_correction_log` empty | 84.1 (depends on T-04) |
| 23 | `canonical_action_executions` empty | T-08 |
| 24 | `draft_borrower_requests` empty | T-08 |
| 25 | `borrower_request_campaigns` empty | T-08 |
| 26 | Samaritus deleted | 84.1 |
| 27 | 4 duplicate Ellmann deals | T-06 |
| 28 | ChatGPT Fix 11-15 in prod | T-10 |
| 29 | `ownership_entities` weak linking | Resolves with T-02 |
| 30 | 46 security_definer_view ERROR | 84.1 |
| 31 | 39 rls_policy_always_true WARN | 84.1 |
| 32 | 88 function_search_path_mutable | 84.1 |
| 33 | vector ext in public schema | 84.1 |
| 34 | 1 deal_voice_session row | Not a code issue — feature adoption |
| 35 | Memory file outdated | T-09 |
| 36 | `.env.example` stale | T-09 |
| 37 | 125+ root markdown files | T-10 |

---

**End of spec.**
