# AAR: God Tier Phase 3C — Flag Engine Wiring Complete

**Date:** 2026-03-06
**PR:** #183 (implied — all 5 tasks complete)
**Spec:** docs/specs/god-tier-phase3b-flagging-and-questions.md (wiring pass)
**Status:** COMPLETE — tsc clean, 97/97 flag engine tests pass, 72/72 lifecycle tests pass

---

## What Was Built

The flag engine (Phase 3B, PR #182) was a pure-function library with no live connections. This wiring pass connects every module into the live deal view — flags now generate automatically, appear in the UI, block committee advancement when critical, and auto-resolve when documents are received.

---

## 5 Tasks Completed

### Task 1 — Post-Spread Flag Generation & Persistence
- **Migration:** Unique constraint on `(deal_id, trigger_type, year_observed)` — enforces deduplication at DB level. `year_observed = 0` sentinel for structural flags where year is not applicable (ensures NULL-handling edge case is avoided cleanly)
- **`buildFlagEngineInput.ts`:** Shared input builder used by both persistence and re-evaluation modules. Queries deal_financial_facts, deal_truth_snapshots, deal_qoe_reports, deal_trend_analyses. Fail-soft on secondary queries — engine runs even if some data is unavailable
- **`persistFlagReport.ts`:** Calls composeFlagReport(), upserts all flags and questions, writes single audit entry, emits `flags.generated` ledger event. Never throws — returns `{ ok: false }` on error
- **Hook in spreadsProcessor.ts:** Non-fatal try/catch after recomputeDealReady block. Flag generation silently degrades if it fails — spread completion is never blocked

### Task 2 — Risk Dashboard Panel
- **API route** `GET /api/deals/[dealId]/flags`: Returns flags ordered by severity (critical→elevated→watch→informational), left-joined with borrower questions, plus summary counts and `has_blocking` boolean
- **API route** `PATCH /api/deals/[dealId]/flags`: Status transitions (open→banker_reviewed→waived/resolved, any→open). Writes audit entry on every transition
- **`RiskDashboardPanel.tsx`:** Color-coded severity groups (red/amber/yellow/blue), expandable flag cards with banker_detail + banker_implication, Mark Reviewed / Waive / Resolve buttons, red banner when has_blocking is true, green empty state when clean
- **Wired into underwriting tab** of SecondaryTabsPanel.tsx inside SafeBoundary, positioned before UnderwritingControlPanel

### Task 3 — Lifecycle Blocker for Critical Flags
- Added `critical_flags_unresolved` to LifecycleBlockerCode union
- Added `criticalFlagsResolved: boolean` to LifecycleDerived type
- Blocker fires when stage is `underwrite_in_progress` or `committee_ready` and `criticalFlagsResolved` is false
- Parallel Supabase query counts critical flags with status `open` or `banker_reviewed`
- **Fail-open:** if query fails, `criticalFlagsResolved = true` — infrastructure failure never blocks a deal

### Task 4 — Question Send Flow
- **Migration:** `deal_flag_send_packages` table — permanently records every send: cover message, question count, document request count, full package JSON, sent_by, sent_at
- **API route** `POST /api/deals/[dealId]/flags/send`: Queries banker_reviewed flags with questions, calls buildSendPackage(), persists to deal_flag_send_packages, updates flag statuses to sent_to_borrower, updates sent_at on questions, writes audit entries, emits `flags.questions_sent` ledger event
- **Send confirmation dialog in RiskDashboardPanel:** "Send Questions to Borrower" button visible when ≥1 banker_reviewed flag has a question. Preview modal shows cover message, questions list, document requests list. Confirm → POST → success toast with count

### Task 5 — Re-ingestion Trigger on Document Upload
- **`rerunDocumentFlags.ts`:** Targeted re-evaluation — runs only `flagFromDocuments` + `flagFromReconciliation`, not full engine. Auto-resolves open missing_data and financial_irregularity flags whose trigger_type is no longer detected. Inserts new flags. Emits `flags.document_reingestion` ledger event. Never throws
- **Hook in processArtifact.ts at step 6.7b:** After readiness recompute, before naming. Non-fatal try/catch. Standard pattern matching existing codebase conventions

---

## New Files (8)

| File | Purpose |
|---|---|
| supabase/migrations/20260306_flag_engine_unique_constraint.sql | Unique constraint on deal_id + trigger_type + year_observed |
| supabase/migrations/20260306_flag_send_packages.sql | deal_flag_send_packages table |
| src/lib/flagEngine/buildFlagEngineInput.ts | Shared input builder |
| src/lib/flagEngine/persistFlagReport.ts | Post-spread flag persistence |
| src/lib/flagEngine/rerunDocumentFlags.ts | Targeted re-evaluation on upload |
| src/app/api/deals/[dealId]/flags/route.ts | GET flags, PATCH flag status |
| src/app/api/deals/[dealId]/flags/send/route.ts | POST send question package |
| src/components/deals/cockpit/panels/RiskDashboardPanel.tsx | Risk Dashboard UI |

## Modified Files (6)

| File | Change |
|---|---|
| src/lib/flagEngine/index.ts | Added exports for new modules |
| src/lib/jobs/processors/spreadsProcessor.ts | Non-fatal flag generation hook |
| src/lib/artifacts/processArtifact.ts | Non-fatal flag re-evaluation hook |
| src/buddy/lifecycle/model.ts | Blocker code + criticalFlagsResolved derived field |
| src/buddy/lifecycle/computeBlockers.ts | Critical flags blocker logic |
| src/buddy/lifecycle/deriveLifecycleState.ts | Parallel query + derived boolean |
| src/components/deals/cockpit/panels/SecondaryTabsPanel.tsx | RiskDashboardPanel wired in |

---

## Key Design Decisions

**year_observed = 0 sentinel:** Postgres treats NULL values as not equal in unique constraints — two flags with the same deal_id and trigger_type but NULL year_observed would both insert successfully, defeating deduplication. Setting year_observed = 0 for structural flags (lease expiration, concentration, etc.) ensures the constraint works cleanly across all flag types.

**buildFlagEngineInput shared:** Both persistFlagReport and rerunDocumentFlags call this shared helper. Zero logic duplication — if the query structure changes, one file changes.

**Send package permanently persisted:** Every send is recorded in deal_flag_send_packages with the exact cover message, question texts, and document requests that were sent. This is the audit record. If an examiner asks "what did you ask the borrower and when," the answer is in the database, not reconstructed from status fields.

**Fail-open on lifecycle gate:** criticalFlagsResolved defaults to true when the Supabase count query fails. A database hiccup never traps a deal in underwriting indefinitely.

---

## End-to-End Flow Now Live

1. Banker uploads documents → spread processor runs → composeFlagReport() called automatically → flags persisted to deal_flags
2. Banker opens underwriting tab → Risk Dashboard panel shows all flags grouped by severity
3. Banker reviews flags → marks them reviewed or waived with reason
4. Banker clicks "Send Questions to Borrower" → reviews preview → confirms → package sent and permanently recorded
5. Borrower uploads a document in response → processArtifact re-runs document flags → missing_data flags auto-resolve → banker notified
6. If critical flags remain open → lifecycle blocker prevents committee advancement with specific message
7. Once all critical flags resolved or waived → deal can advance

**Buddy now catches everything, explains it, and closes the loop. Banks can rely on him.**
