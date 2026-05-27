# HARD_STOPS_AUDIT — SPEC-BUDDY-HARD-STOP-AUDIT-AND-RECOVERY-1

**Auditor**: Claude (Opus 4.7)
**Date**: 2026-05-27
**Scope**: 7 known hard-stop categories where Buddy silently blocks banker/borrower progress without a visible blocker reason, next action, retry path, or admin diagnostic.

A "hard stop" is any place where a forward action is disabled, missing, or fails silently and the user is not told *why* and *what to do next*. Each row below cites concrete file:line evidence gathered by parallel source-level audits.

---

## 1 — Loan request canonicalization ✅ ALREADY FIXED

| | |
|---|---|
| Files | `src/app/(app)/deals/[dealId]/loan-terms/page.tsx:16`, `src/app/(app)/deals/[dealId]/loan-request/page.tsx:79`, every CTA below |
| Blocker | Two pages potentially co-existing; bookmarked legacy URLs land on stale UI |
| Symptom | None — already mitigated |
| Root cause | n/a — legacy page is now a server `redirect()`; all CTAs point to canonical |
| Fix required | None. Verified canonical: `nextAction.ts:259/265`, `usePrimaryCTA.ts:144`, `ReadinessPanel.tsx:493`, `intakeDeepLinks.ts:28`, `evaluateMemoReadinessContract.ts:82`, `getDealAnalysisStatus.ts:544`. 11 guard tests in `loanRequestCanonicalityGuard.test.ts` + `loanRequestPageRenders.guard.test.ts`. |
| Priority | — (closed) |

---

## 2 — Product catalog unavailable → Add Request silently disabled

| | |
|---|---|
| Files | `src/components/loanRequests/LoanRequestsSection.tsx:1284,1304,1325–1335,1347,1171–1196`, `src/app/api/loan-product-types/route.ts:146,282`, `src/lib/loanRequests/actions.ts:233–283` |
| Blocker | `<Button disabled={saving \|\| productTypesLoading \|\| !productTypesReady}>` where `productTypesReady = !productTypesLoading && productTypes.length > 0` |
| Symptom | Banker sees a disabled "Add Request" button. The amber-warning sits *below* the button; banker scrolls past it. There is no Retry button — they must reload the page. There is no admin link to fix the catalog. |
| Root cause | API legitimately returns `{ ok: true, productTypes: [] }` when (a) bank has no enabled overrides AND (b) global catalog has no enabled rows. Empty array is treated identically to "still loading" by the gating logic, even though the fetcher *does* distinguish loading vs. empty vs. error in state. |
| Fix required | (a) Surface error/empty state *above* the button; (b) add explicit **Retry** button that calls `loadProductTypes()`; (c) add an admin-only "Configure Loan Products" link (gated by an `isAdmin` check we already have); (d) add a guard test asserting the Add Request button cannot be `disabled` without a visible adjacent reason + retry affordance. |
| Priority | **P0** |

---

## 3 — Intake worker claim path → silent stall via schema drift ✅ MOSTLY FIXED

| | |
|---|---|
| Files | `src/lib/workers/workerLock.ts`, `src/lib/workers/processIntakeOutbox.ts`, `src/lib/intake/processing/handleStuckRecovery.ts`, `supabase/migrations/20260701000000_worker_advisory_xact_lock.sql` |
| Blocker | Worker called `claim_intake_outbox_with_xact_lock` but production Supabase only had `claim_intake_outbox_batch`. PostgREST 404 was caught as `lock_not_acquired` and looked like benign lock contention. |
| Symptom | `intake.process` rows stayed at `attempts=0, claimed_at=null` forever. Polling client kept reenqueueing every 3 min. Deal stuck in `CONFIRMED_READY_FOR_PROCESSING` indefinitely (e.g., `dc52c626-fa42-40d3-9b74-7d197ce36bac`). |
| Root cause | Migration was committed locally but never applied to remote project. |
| Fix required | Already shipped in SPEC-INTAKE-OUTBOX-WORKER-CLAIM-PATH-1: migration applied, `claim_rpc_failed` reason added, `intake.processing_worker_not_claiming` event, 9 source-level guard tests. **Remaining work for this spec**: distinguish `zero_work` as a third explicit outcome (currently encoded as `{skipped:false,rows:[]}` but not labelled). |
| Priority | **P0** (zero_work extension only) |

---

## 4 — Deleted-route polling

| | | 
|---|---|
| File:Line | `src/lib/auth/useRole.ts:15` — `fetch("/api/auth/role")` |
| File:Line | `src/buddy/cockpit/useCockpitData.tsx:111` — `fetch("/api/deals/${dealId}/uploads/status")` |
| File:Line | `src/components/deals/DealCockpitNarrator.tsx:39` — `fetch("/api/deals/${dealId}/uploads/status")` |
| File:Line | `src/buddy/portal/useBorrowerPortalData.tsx:65` — `fetch("/api/portal/deals/${dealId}/uploads/status")` |
| Blocker | After recent route-cap cleanup (27eae9a1, f4132ceb, 824c90f7), these client hooks poll endpoints that no longer exist. Each tick returns 404; client error-handling either silently treats the failure as "no data" or floods the console. |
| Symptom | Stuck loading spinners; "no data" empty states with no surfaced error; quietly elevated 404 noise in monitoring. |
| Root cause | Routes deleted without auditing client-side fetchers. `/api/aegis/health` was the user's already-found case. |
| Fix required | (a) Either restore the routes or replace the fetches with the surviving equivalents (`/uploads/readiness`, `/uploads/inbox`, `/uploads/audit`, `/uploads/reconcile`); (b) add `scripts/check-client-api-fetches.mjs` that scans `fetch("/api/...")` and `fetch(\`/api/...\`)` against routes defined under `src/app/api/`, with an allowlist for `[...path]` / `[param]` catch-alls; (c) wire as `npm run check:api-fetches` and add to CI. |
| Priority | **P0** |

---

## 5 — Schema drift on critical tables

| | |
|---|---|
| Authoritative columns (verified against production via Supabase MCP 2026-05-27): | `deal_events`: `id, deal_id, kind, payload, created_at` |
| | `buddy_outbox_events`: `id, kind, deal_id, bank_id, payload, delivered_at, attempts, last_error, claimed_at, claim_owner, source, delivered_to, next_attempt_at, dead_lettered_at, created_at` |
| | `deal_loan_requests`: 41 columns — all current code accesses verified valid |
| | `deal_documents`: 78 columns — all current code accesses valid except brokerage golden-run |
| Blocker | Multiple `.insert()` paths write **columns that don't exist** in the production schema. The Supabase JS client returns an error, callers swallow it via `void` / `.catch(() => {})`, and the event never lands. |
| Symptoms | E-Tran export emits no `etran.exported` deal_events; SMS webhooks emit no inbound/status deal_events; deal action audit trail is empty; brokerage golden-run never records uploaded filenames. None of these is user-visible directly — they show up as "where did the event go?" days later. |
| Specific drift rows (18 inserts) | `src/lib/etran/generator.ts:340,341,358,359,377,378` — inserts `event_type` + `event_data` (should be `kind` + `payload`) |
| | `src/lib/sms/send.ts:89` — inserts `metadata` (should be `payload`) |
| | `src/app/api/webhooks/twilio/status/route.ts:31` — inserts `metadata` (should be `payload`) |
| | `src/app/api/webhooks/twilio/inbound/route.ts:133–135,136,163–165,166,195–197,198,227–229,230` — inserts `description` (not a column) + `metadata` (should be `payload`) |
| | `src/app/api/deals/[dealId]/actions/route.ts:104,105` — inserts `event_type` (should be `kind`) + `actor_id` (not a column) |
| | `src/lib/brokerage/goldenRun.ts:70` — inserts `file_name` (should be `original_filename`) on `deal_documents` |
| Fix required | (a) Rewrite each `.insert()` to the correct column names; collapse stray fields (`description`, `actor_id`) into `payload.*`. (b) Add a fast source-level guard test that greps the codebase for `from("deal_events")` / `from("buddy_outbox_events")` / `from("deal_documents")` `.insert(`/`.update(` calls and asserts no banned column-name tokens (`event_type`, `event_data`, `metadata:`, `description:` adjacent to deal_events, `actor_id:` adjacent to deal_events, `file_name:` adjacent to deal_documents). |
| Priority | **P0** |

---

## 6 — Readiness/pricing blockers ✅ ALREADY GOOD

| | |
|---|---|
| Files | `src/app/(app)/deals/[dealId]/pricing/page.tsx:142–143`, `src/app/(app)/deals/[dealId]/pricing/DealPricingClient.tsx:370–449` |
| Blocker | Pricing page gates on `spreadsComplete && financialSnapshotExists && researchComplete` |
| Symptom | None — the page already shows 3 checkboxes (financial snapshot / spread analysis / institutional research) with ✓/○ indicators, each unfinished item has a direct `<Link>` to the relevant tool (`/deals/{id}/spreads`, `/deals/{id}/underwrite`), auto-refreshes every 30s when only spreads block, keeps `PricingAssumptionsCard` and `PricingScenariosPanel` visible above the gate (so banker can still create defaults and try to generate scenarios), and surfaces a Back-to-Cockpit affordance. |
| Root cause | n/a — already actionable. |
| Fix required | None. Optional polish: when the loan request is missing, link directly to `/loan-request` from this panel (currently shows research/spreads links only). Captured as P1 to consider; not required. |
| Priority | **P1** (optional polish, not required for acceptance) |

---

## 7 — Blank/weak deal names

| | |
|---|---|
| Files | `src/lib/intake/processing/processConfirmedIntake.ts:622–635,689–703`, `src/lib/naming/applyDealDerivedNaming.ts:194,241`, `src/lib/naming/runNamingDerivation.ts`, `src/lib/deals/isAutoGeneratedDealName.ts:27`, `src/lib/builder/builderDealsCore.ts:25–26` |
| Blocker | `runNamingDerivation()` is called during intake but is best-effort — anchor-doc unavailable / OCR null / classifier disagrees → naming silently leaves the deal at "NEEDS NAME" or `Untitled deal N`. |
| Symptom | Cockpit and pipeline list show "NEEDS NAME" / "Untitled deal", downstream tracking (ledger, memo, pricing snapshots) shows the placeholder, banker has to manually rename. |
| Root cause | No final fallback after `runNamingDerivation`. The deal phase transitions to PROCESSING_COMPLETE / PROCESSING_COMPLETE_WITH_ERRORS without re-checking `name`. |
| Fix required | Add `src/lib/naming/repairBlankDealName.ts` that — when `deals.name` is blank, `Untitled*`, or `NEEDS NAME` — derives a name from `borrower_name`, then primary `deal_owners.full_name`, finally `Deal YYYY-MM-DD <shortId>`. Wire it into `processConfirmedIntake.ts` after `runNamingDerivation()` (around line 635, before the terminal `transitionPhaseAndEmit`). Never block phase transition on name-repair failures. |
| Priority | **P1** |

---

## Execution plan

P0 fixes implemented in this pass:
1. Worker `zero_work` outcome added to `claimWithXactLock` + extended guard test.
2. Schema-drift inserts repaired across 6 files + new `schemaDriftGuard.test.ts`.
3. Deleted-route fetches replaced/removed + `scripts/check-client-api-fetches.mjs` + `npm run check:api-fetches`.
4. Product catalog: explicit Retry button, admin-link affordance, error/empty UI moved above the disabled button + guard test.

P1 fixes implemented in this pass:
5. `repairBlankDealName` helper + intake hook.

(P1 pricing polish deferred — already actionable.)

Acceptance:
- `tsc --noEmit` clean.
- Worker + intake + new guard tests pass.
- No primary banker path has a disabled button without a visible reason + retry/repair affordance.
- No deleted API route fetched by client code (enforced by script).
- No critical-table insert references a column not present in the schema (enforced by guard).
- Loan request has one canonical flow (already true).
