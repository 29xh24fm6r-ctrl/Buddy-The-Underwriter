# SPEC-WALKTHROUGH-CONVENTIONAL-V1 — Friction Addendum (Phases 1-2)

**Filed:** 2026-05-08
**Companion to:** `SPEC-WALKTHROUGH-CONVENTIONAL-V1.md` (commit `f771b98a`)
**Scope:** Findings from Claude-in-chat's manual walkthrough of Phases 1-2 that the structural correctness audit missed or downgraded.
**Method:** Hand walkthrough of route topology, page rendering, and component behaviour. Read every active route page top-to-bottom, traced data flow, ran live Supabase verification queries against schema and data.
**Bar:** Elite tier — no friction, no confusion, no interruptions.

## Why this addendum exists

The structural audit (`SPEC-WALKTHROUGH-CONVENTIONAL-V1.md`) answered "does the conventional banker flow work end-to-end without breaking?" Answer: yes, with 2 legacy P0s.

This addendum answers a different question: "is the conventional banker flow elite-tier?" Answer: no — there are several friction issues, lying UI elements, hardcoded values, dead components, and architectural duplications that the structural pass didn't catch because it wasn't asking that question.

The two reviews are complementary. Both belong in the record.

## Friction findings — Phases 1-2 only

| # | Phase | Location | Severity | Finding | Recommendation |
|---|-------|----------|----------|---------|----------------|
| F1 | 2 | `src/components/underwrite/AnalystWorkbench.tsx:161-203` + `WorkstreamCard.tsx` | **P0** | The three primary action buttons on the AnalystWorkbench WorkstreamCards (Spreads, Credit Memo, Risk & Structure) only flip a status field via PATCH. They do NOT navigate to spreads/memo/risk workspaces. Click "Start Spreads" → status flips to `in_progress` → no panel opens, no tool surfaces, no navigation. The literal core interaction surface of the canonical underwriting workspace is cosmetic. | Either wire each button to navigate to its corresponding workspace (`/spreads`, `/credit-memo`, `/risk`), or remove the buttons and rely on `UnderwritingPipelineRail` (which IS wired correctly). Do not ship both. |
| F2 | 1 | `src/app/(app)/deals/[dealId]/cockpit/page.tsx` + `src/app/(app)/deals/[dealId]/underwrite/page.tsx` | **P0** | Two parallel workspace surfaces with overlapping purpose. Bare `/deals/[dealId]` redirects to `/cockpit` (deal "front door"). Cockpit is an 11.6KB workspace with its own client component, lifecycle state, readiness derivation. Underwrite is the canonical underwriting workspace with `AnalystWorkbench`. Banker journey requires navigating cockpit → underwrite → credit-memo as three distinct full-page surfaces. | Make a deliberate decision: (a) merge cockpit into underwrite, OR (b) make cockpit a lightweight overview that frames underwrite, NOT a full workspace. Document the chosen topology. |
| F3 | 1 | `src/app/(app)/deals/page.tsx:215-220` | **P1** | Search input is decorative. `<input type="search" placeholder="Search deals..." />` has no `value`, no `onChange`, no form submit, no handler. Banker can type — nothing happens. Pure UI lie. | Implement search (filter `deals` query by `display_name`/`borrower_name` ILIKE) or remove the input. |
| F4 | 1 | `src/app/(app)/deals/page.tsx:130` | **P1** | Borrower column displays raw `borrower_name \|\| name`. Per project memory, `display_name` is canonical for borrower-facing surfaces; `borrower_name`/`name` carry fixture strings on Samaritus ("ChatGPT Fix 15"). For Samaritus the deal list shows "ChatGPT Fix 15" in the Borrower column. | Use `dealLabel()` resolution for borrower display, or fix Samaritus's stale `borrower_name`/`name` fields to match `display_name`. |
| F5 | 2 | `src/app/(app)/deals/[dealId]/DealShell.tsx:230` | **P1** | DealShell header borrower line falls back to `deal?.name`. Same `name` leak as F4 — for Samaritus this displays "ChatGPT Fix 15" in the header above the inline editor. | Strip `name` from the fallback chain or use `dealLabel()` resolution. |
| F6 | 2 | `src/app/(app)/deals/[dealId]/underwrite/page.tsx:55-67` | **P1** | Guard ordering: `verifyUnderwrite({ dealId, actor: "system" })` runs BEFORE `ensureDealBankAccess`. A banker from Bank A loading Bank B's deal triggers a verifyUnderwrite call (which writes to `deal_pipeline_ledger`) and a downstream ledger query before the tenant guard rejects. The tenant guard should run first. | Reorder: tenant guard → verify → lifecycle. |
| F7 | 1 | `src/app/(app)/home/page.tsx:8` | **P1** | Hardcoded `bankId="demo-bank"` and `bankName="Demo Bank"` passed to `CommandBridgeV3`. This is the post-login `/home` route. Real bankers would see demo-bank's data. **Tenant isolation hole at the post-login home surface.** Audit caught this as P1 finding #9. Re-flagged here for severity escalation: P0 if `/home` is reachable in production for real bankers; P1 if only reachable in dev. | Replace with `tryGetCurrentBankId()` or gate `/home` behind a dev-only flag. |
| F8 | 2 | `src/components/underwrite/UnderwriteConsole.tsx` | **P1** | Component is 17.2KB and present in source. Phase 57C retired the `/underwrite-console` route (now redirects to `/underwrite`), but the component itself was not deleted. Either it's still imported somewhere (in which case "retired" is incomplete) or it's dead code. | Grep for imports. If unused, delete. If used, document where and rename. |
| F9 | 1 | `src/app/(app)/deals/page.tsx:85-100` | **P2** | Schema-fallback pattern: try rich select; on error, inspect `error.message` for substrings "column" or "does not exist", fall back to minimal select. This pattern masks any error type that doesn't contain those substrings — silent zero rows. | Use a structured error type or just always run the minimal select if schema variation is real. |
| F10 | 1 | `src/app/(app)/deals/page.tsx:200-212` | **P2** | 5-second timeout race on `verifyUnderwrite` for ALL deals in the list. If verifyUnderwrite is slow on any one deal, ALL deals show "Unavailable". With 80-deal limit, this is a real perf risk. The catch swallows the error — banker has no idea what happened. | Move verifyUnderwrite to a per-deal lazy fetch, or batch with a longer overall timeout, or precompute and cache. |
| F11 | 1 | `src/app/(app)/deals/page.tsx:269-289` | **P2** | Stage and Status columns side-by-side displaying related-but-distinct concepts (`deal.stage` vs `derivePipelineStatus(d)`). Banker has to learn the difference. | Either merge into one column or label them more distinctively. |
| F12 | 1 | `src/app/(app)/deals/page.tsx.stitch-backup` (25KB) | **P2** | A `.stitch-backup` file sitting in production source. Either it's a rollback artifact (belongs in git history) or load-bearing via dynamic import. | Confirm not imported, delete from source tree. |
| F13 | 2 | `src/components/underwrite/AnalystWorkbench.tsx:38-50` | **P2** | Two sequential network requests on mount: `/api/deals/${dealId}/state` then `/api/deals/${dealId}/underwrite/state`. They run as separate `useEffect`s. Banker waits for two roundtrips. | Parallelize via `Promise.all`, or merge into a single workbench-state endpoint that includes omega. |
| F14 | 2 | `src/components/underwrite/AnalystWorkbench.tsx:42, 58, 76, 95-97` | **P2** | Silent catches: `.catch(() => {})`, `catch { /* silent */ }`. If any fetch fails, banker gets no error UI — workspace shows empty/uninitialized state, which is misleading. | Replace with `console.warn` minimum, or surface a banner. |
| F15 | 2 | `src/components/underwrite/AnalystWorkbench.tsx` + `UnderwritingPipelineRail.tsx` | **P2** | TWO parallel UI surfaces in the same workspace: the pipeline rail (API-backed actions) and the three workstream cards (cosmetic status toggles). Banker has to figure out which is the real interaction surface. | Pick one. The pipeline rail is functionally complete; the workstream cards are decorative. Remove the cards or repurpose them as read-only status tiles. |
| F16 | 2 | `src/app/(app)/deals/[dealId]/underwrite/page.tsx:96, 119, 146` | **P2** | All three failure UIs link "Go to Deal Cockpit" as recovery CTA. For tenant_mismatch, that's actively wrong — sending an unauthorized banker to cockpit will hit the same error. | Per-error CTA: tenant_mismatch → `/deals`; lifecycle → cockpit; verify → cockpit. |
| F17 | 2 | `src/app/(app)/deals/[dealId]/cockpit/page.tsx:196-199` | **P2** | Cockpit's `requiredDocsCount`/`missingDocsCount` simplified to binary 1/0 with comment `// simplified: binary for UI`. Banker sees "ready / not ready" instead of "8 of 12 docs collected". | Surface real counts from `lifecycleDerived`. |
| F18 | 1 | `src/proxy.ts:14-22` | **P1** | Documented unresolved collision: borrower magic-link `/portal/[token]` collides with banker `/portal` tree. Comment admits "tracked separately (see Sprint A.1 PR description)". | Resolve the collision or document why deferred. |
| F19 | (root) | `src/__disabled__/` | P3 | Disabled code directory at top of source tree. | Confirm not imported, delete. |
| F20 | (root) | `src/pages/` and `src/app/` coexist | P3 | Both Pages Router and App Router present. | Audit `src/pages/` for live routes. If empty/dead, delete. |

## Findings already in the structural audit (cross-referenced for completeness)

These items are in `SPEC-WALKTHROUGH-CONVENTIONAL-V1.md`. Restated here for triage convenience:

- Audit P0 #1 — orphaned `/banker/dashboard` (related to F7 hardcoded `demo-bank`)
- Audit P0 #2 — borrower portal `/borrower/update` writes to legacy `deal_memo_overrides` (already tracked in SPEC-13.7)
- Audit P1 #3 — no banker landing redirect from `/`
- Audit P1 #7 — DealShellMemoCta doesn't auto-refresh after submit
- Audit P2 #10 — `loadCollateralItems` bank_id filter no-op (already filed at `specs/follow-ups/SPEC-FOUNDATION-V1-PR2-load-collateral-items-bank-id-filter-bug.md`)

## What this addendum does NOT cover

Phases 3-7 (document ingestion, banker inputs, memo assembly, submission, post-submission) were covered by the structural audit but NOT by Claude-in-chat's friction walkthrough. A friction pass on those phases is queued as future work.

## Two architectural reframings worth surfacing

### A1. Cockpit vs Underwrite vs Credit-Memo as three full-page surfaces

The current banker journey treats deal selection → cockpit → underwrite → credit-memo as four separate full-page navigations. Each has its own data fetches, its own header, its own JourneyRail render. Transitions are full page loads.

**Question for product/architecture:** is the three-workspace topology intentional, or residue of incremental development? An elite-tier banker experience might collapse cockpit and underwrite into a single workspace with sub-views, with credit-memo as a final destination. Worth a deliberate decision before more workspace-level features ship.

### A2. Decorative UI is more harmful than missing UI

Several findings (F1, F3, F15) involve UI elements that LOOK functional but aren't. A button that flips a status field but doesn't navigate. A search input that accepts keystrokes and discards them. Workstream cards that look like the primary interaction surface but are cosmetic.

These are worse than missing UI because they actively mislead the banker. An elite-tier flow should have *fewer* surfaces, all of which do what they look like they do.
