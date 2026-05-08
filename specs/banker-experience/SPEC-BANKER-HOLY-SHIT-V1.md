# SPEC-BANKER-HOLY-SHIT-V1 — The Elite-Tier Banker Experience

**Path:** `specs/banker-experience/SPEC-BANKER-HOLY-SHIT-V1.md`
**Filed:** 2026-05-08
**Status:** North star — supersedes nothing, governs the work that closes the gap to elite tier
**Owner:** Matt (vision) → Claude in chat (architecture) → Claude Code (implementation across multiple sub-PRs)
**Bar:** When a banker runs their next deal through Buddy, they say *"holy shit, this changed my life."*

---

## 0. What this spec is, and what it isn't

This spec is **not** a redesign. The elite-tier substrate is mostly built. The banker-journey-fluidity arc (SPEC-01 through SPEC-13) shipped 11 of 14 specs. The canonical credit memo (`src/lib/creditMemo/canonical/`) is institutional-grade as shipped — `CanonicalCreditMemoV1` shape, `narrativeAssembly.ts` with the committee-grade prompt you tuned with ChatGPT, `buildRatioAnalysisSuite.ts` with deal-specific interpretations across 25+ ratios, Phase 81-92 layering committee certification, Five Cs scoring, stress testing, covenant packaging, and evidence coverage tracking.

This spec **is** a delta map. It names exactly what stands between the substrate as-shipped and the holy-shit moment, and it sequences that delta into shippable work.

The honest reframe: 80% of the work that delivers the elite-tier banker experience is already done. The Holy Shit Spec exists to close the remaining 20%, verify the whole substrate end-to-end on a fresh never-hand-debugged deal, and stop the codebase from accumulating new debt that erodes the substrate.

---

## 1. The promise

A banker uploads borrower documents on Monday afternoon. They walk into Buddy on Tuesday morning. The persistent journey rail shows them where they are. The deal has the borrower's real name. Documents have been classified, facts have been extracted, the Classic Spread PDF is rendered, the canonical credit memo has its narratives generated, the DSCR is computed. The readiness checklist shows three items remaining — one for them with an inline form, two that Buddy is finishing on its own with visible live progress. The advisor panel says "Very high confidence" instead of "85%" and explains exactly why this deal has the risk profile it has. They enter the one banker input, click submit, see the success, and move on with their day.

This is the holy-shit moment. Everything else in this spec exists to deliver it.

---

## 2. What's already shipped (the substrate)

This spec sits on top of substantial existing infrastructure. To avoid redrafting what exists, this section names the load-bearing pieces and treats them as governing contracts that downstream work consumes without modifying.

### 2.1 The journey rail and stage-driven cockpit (SPEC-01, SPEC-02)

A persistent `JourneyRail` renders left-of-content across every banker-facing deal surface. It shows the 11 canonical lifecycle stages (`intake_created` through `closed`, plus `workout` off-path), highlights current, surfaces blockers with fix actions, and exposes one primary action derived from `getNextAction(state, dealId)`. The DealShell tab strip is collapsed to four utility tabs. Stage-specific work happens inside `*StageView` components that compose existing panels.

### 2.2 Action execution and stage-owned data (SPEC-04, SPEC-05, SPEC-06)

Every cockpit action — navigate, runnable, blocker-fix — flows through one shared executor (`runCockpitAction`, `useCockpitAction`). Stages own their data via `useStageJsonResource` with scoped refresh (`refreshStageData("conditions" | "overrides" | "memo" | …)`). Inline editing works for conditions and overrides without page navigation, with optimistic updates and undo affordances.

### 2.3 The cockpit advisor (SPEC-07, SPEC-08, SPEC-09, SPEC-12)

`CockpitAdvisorPanel` (24KB) is a persistent advisor surface watching telemetry, ranking signals (critical → needs-attention → suggested-actions → recent-activity → acknowledged), surfacing deterministic behavior patterns (`repeated_action_failure`, `stage_oscillation`, `stale_blocker`), emitting predictive warnings (`committee_failure_risk`, `committee_delay_risk`, `closing_delay_risk`, `decision_quality_warning`, `approval_without_conditions`, `override_without_rationale`, `memo_mismatch_risk`, `attestation_gap`), with evidence rows backing every signal. All deterministic. No LLM hallucination risk.

### 2.4 The canonical credit memo (Phase 81-92, narrativeAssembly tuning)

`buildCanonicalCreditMemo.ts` (64KB) produces `CanonicalCreditMemoV1` — header with action type, key transaction metrics, sources & uses, NAICS-aware eligibility, collateral with line items + advance rates + lien position, business + industry analysis with BIE v3 fields (credit_thesis, structure_implications, underwriting_questions, monitoring_triggers, contradictions, management_intelligence), management qualifications, financial analysis (debt coverage table, income statement table, balance sheet table, ratio analysis with deal-specific interpretations across 25+ ratios with explicit benchmarks, breakeven), global cash flow, personal financial statements per guarantor, executive summary, transaction overview, sponsor pool, risk factors, strengths/weaknesses, policy exceptions, proposed terms, conditions, recommendation, stress testing (Phase 90A), covenant package (Phase 90B), Five Cs qualitative assessment (Phase 90C), committee certification (Phase 81 — `isCommitteeEligible`, `trustGrade`, `subjectLocked`, `renderMode`, `evidenceSupportRatio`).

`narrativeAssembly.ts` (21KB, Gemini Pro, 8192 tokens, 55s timeout) drives the prose layer with a committee-grade system prompt — required first-sentence templates for executive summary, mandatory category structure for income_analysis (Liquidity/Leverage/Coverage/Profitability/Activity), mandatory dollar-translation in Coverage paragraph, repayment_analysis section synthesizing stress test results, seven absolute rules including never-generic-without-value and never-invent-numbers.

### 2.5 The canonical input store (SPEC-13, FOUNDATION-V1 PR1+PR2)

`deal_borrower_story`, `deal_management_profiles`, `deal_collateral_items` are the canonical qualitative-input tables. The wizard rewires writes through `upsertBorrowerStory` / `upsertManagementProfile` / `upsertCollateralItem`. Legacy `deal_memo_overrides` is read-only with auto-migration on first read (`migrateLegacyOverridesAsync.ts`). Prefill engine reads legacy overrides as a 7th source (`prefillMemoInputs.ts`). The credit-memo redirect to memo-inputs is now visible.

---

## 3. What's the gap (the delta)

To get from substrate to holy-shit, six things have to close. The spec sequences them into phases.

**Gap 1 — Trust language (SPEC-12.1 unshipped).** The advisor panel still says "85% confidence" instead of "Very high confidence." It still shows raw priority numbers and rankReason strings instead of a structured "Why this matters" block. The graduated risk score (committee_failure_risk → 0–100+ → critical/warning/below_threshold) doesn't exist; the legacy trigger union still emits binary fire/no-fire. SPEC-12.1 is the spec that closes this. Pure modules: `buildRiskScore.ts`, `confidenceLabel.ts`, `useAdvisorSignalThrottle.ts`. None exist on `main`.

**Gap 2 — Compute is banker-triggered, not automatic.** DSCR populates only when a banker clicks "Generate Spread" on the Classic Spreads page. The PRECHECK we ran on Samaritus today verified the embedded compute pathway works correctly, but it lives inside `classic-spread/route.ts` and only fires on banker click. The Classic Spread PDF is generated on demand, not pre-rendered. A fresh deal sits with empty DSCR / Classic Spread until a banker manually triggers them. This is the single biggest UX leverage point in the spec.

**Gap 3 — Readiness blockers don't show live progress for Buddy-owned work.** `evaluateMemoReadinessContract` already labels blockers with `owner: "buddy" | "banker"`. The UI surfaces this at the contract level but doesn't lean into "Buddy is working on it" framing — research running with seconds elapsed, fact extraction with documents-of-total counts, narrative generation with Gemini-call-in-flight indicator. The data is in the ledger; the UI doesn't surface it.

**Gap 4 — Display name canonicality leaks.** `display_name` is the canonical field. `borrower_name`, `name`, `legal_name` still leak through fallbacks in some surfaces. Samaritus's `deals.name` and `deals.borrower_name` still hold the fixture string "ChatGPT Fix 15" — only `display_name` carries the real label. P1 leak risk on any borrower-facing surface reading the wrong field. No CI guard prevents regression.

**Gap 5 — Cosmetic UI surfaces still lie.** AnalystWorkbench WorkstreamCards flip a status field on click but don't navigate. The deals-list search input accepts keystrokes and discards them. `/home` ships hardcoded `bankId="demo-bank"`. `/spreads/page.tsx` lacks `ensureDealBankAccess`. `UnderwriteConsole.tsx` (17KB) is orphaned after Phase 57C retired its route. `src/__disabled__/` and `page.tsx.stitch-backup` sit in production source. These are individually small but they collectively erode the "no surface lies" commitment.

**Gap 6 — Borrower handoff is banker-mediated.** When the banker needs additional documents from a borrower, the borrower's experience for delivering them is not frictionless. The borrower magic-link portal exists at `/portal/[token]` but the loop from "banker requests document" to "document classified and facts extracted" still routes through banker actions in many cases. A banker who has to chase PDFs to deliver a Tuesday-morning holy-shit moment will have a different Tuesday morning.

That's the gap. Six items. Everything below is how to close them in order.

---

## 4. The five commitments (governing principles)

Every workstream in this spec serves these five commitments. If a proposed change conflicts with any of them, the change is rejected.

**Commitment 1 — One persistent workspace shell per deal.** A banker working on a deal stays in one shell. Sub-views (build, review, submit) are panels or URL-routed tabs within that shell, not separate pages with full reloads. The journey rail and stage-driven cockpit (SPEC-01/02) already deliver this contract. New work preserves it.

**Commitment 2 — Compute is automatic, not banker-triggered.** Every computation that the readiness contract or memo build depends on runs automatically when its inputs become available. Bankers click buttons to enter their own inputs (loan amount, business description, principal bios) and to submit the final memo. They do not click buttons to compute DSCR, render the Classic Spread, run preflight, materialize facts, or refresh the snapshot.

**Commitment 3 — Readiness shows ownership and progress.** The readiness checklist tells the banker, for every blocker, who owns it and what's happening. Buddy-owned blockers show live progress. Banker-owned blockers show a clear inline action. Nothing in the checklist is silent.

**Commitment 4 — Display name is canonical, everywhere.** Every borrower-facing surface uses `display_name` resolved through `dealLabel()` or `resolveDealLabel()`. Raw `borrower_name`, `name`, `legal_name` never reach the UI directly. CI guards prevent regression.

**Commitment 5 — No surface lies.** Every visible UI element does what it appears to do. Buttons that look like they navigate, navigate. Inputs that look searchable, search. Status badges that show "ready" mean ready. Decorative elements either get wired up or get deleted.

**Cross-cutting principle — Perceptible-latency budget.** Every banker-facing interaction has a target time budget. Page loads ≤1s. Compute trigger acknowledgments ≤200ms (with progress for longer work). Submit ≤3s. Document upload acknowledgment ≤500ms. Anything that exceeds budget either gets optimized or explicitly surfaces "this takes a moment, here's why."

---

## 5. The canonical banker journey

Defined in plain English, step by step. This is what a fresh deal walking the elite-tier surface looks like. Every workstream below either makes this journey real or removes friction from it.

**Pre-deal.** A banker has a borrower's package — tax returns, financials, PFS, bank statements. Already authenticated, bank context resolved at login.

**Step 1 — Create.** Banker clicks "New Deal." Drops borrower documents into intake. Confirms borrower display name. Deal is created. Lands in the canonical workspace at `/deals/[dealId]/cockpit`. The journey rail shows `intake_created`. Time budget: under 30 seconds.

**Step 2 — Buddy works (visible).** The cockpit body shows the deal context, the empty banker-input slots, and the readiness panel. Buddy-owned blockers are running with live progress: "Documents classifying — 7 of 12 done", "Facts extracting — interim 6 months extracted, FY24 in flight", "Research mission — 45s elapsed", "DSCR computing — pending NCADS materialization." Banker-owned blockers show inline forms: loan amount, business description, principal bios.

**Step 3 — Banker enters inputs.** Inline. No page navigation. Each input clears its corresponding gate immediately on save. The advisor panel side-comments: "Loan request looks reasonable for the borrower's revenue profile" or "Business description is short — committee will ask for more on competitive positioning."

**Step 4 — Buddy completes.** Documents finish processing. Facts materialize. Aggregator runs automatically. DSCR computes. Classic Spread PDF pre-renders. Research mission completes. Five Cs qualitative scores compute. Stress test runs. Narratives generate via the canonical builder. The readiness panel goes green item by item, in real time. The advisor panel updates: predictive warnings emit if the substrate suggests committee risk; "Why this matters" blocks explain each.

**Step 5 — Review.** Banker reviews:
- The financial spreads (Interactive sub-tabs)
- The Classic Spread PDF (downloadable, examiner-ready, pre-rendered)
- The auto-generated canonical credit memo (committee-grade prose from `narrativeAssembly.ts`)
- The research findings
- The Five Cs scores with composite
- Any flagged conflicts or exceptions
- The advisor's "Why this matters" for each predictive warning

All inside the same shell. Each is a tab or panel inside the journey-rail-driven workspace.

**Step 6 — Submit.** Submit button is enabled when all readiness gates clear. One click. Snapshot lands. Memo freezes. Audit ledger writes. Lifecycle advances. UI shows success and updates the CTA.

**Step 7 — Done.** Deal is submitted. Read-only memo + Classic Spread PDF available. Banker navigates away or opens another deal.

That's the journey. Everything below makes it real.

---

## 6. Workstreams

Each workstream is a multi-PR arc. Numbering is for reference, not strict sequencing — sequencing is in §7.

### Workstream A — Substrate verification, not rebuild

**Premise:** the substrate is 80% built. Phase 1 of this spec is *finishing* it, not redrafting it.

**A1 — Ship SPEC-12.1.** The trust-language layer that didn't ship. Pure modules: `buildRiskScore.ts`, `confidenceLabel.ts`, `useAdvisorSignalThrottle.ts`. Score-driven committee_failure_risk (0–100+, thresholds 70/40), human-readable confidence labels ("Very high confidence" not "85%"), structured "Why this matters" with deterministic opener + evidence bullets + closer, content-hash throttling on rapid stage refreshes. Estimated 3–5 days.

**A2 — Verify SPEC-10/11 server-side surface.** Confirm `buddy_advisor_feedback` and `buddy_blocker_observations` migrations shipped with RLS, server-side dismiss counts, debounced observation writes, server-side snooze filtering. If gaps exist, ship them. Estimated 2–4 days unknown until verified.

**A3 — Substrate completeness audit for canonical memo.** Walk a fresh deal end-to-end and observe what data lands at each stage of the canonical builder pipeline (intake → extraction → fact materialization → ratio suite build → stress test build → qualitative assessment build → research mission → narrative assembly). Document the substrate-completeness contract: what must be true at each upstream stage for the canonical builder to produce committee-grade output without fallback paths kicking in. File any gaps as targeted fixes. The credit memo is god-tier *as shipped* — A3 verifies it produces god-tier output for a fresh deal, not just for hand-debugged Samaritus. Estimated 3–5 days.

**A4 — `/cockpit` vs `/underwrite` vs `/credit-memo` shell continuity audit.** SPEC-01 made the journey rail persistent across surfaces, but the three URLs are still three URLs with full page transitions. Decide: collapse into URL-routed tabs within one shell, or accept the three-URL split with persistent rail and surface them as "you are here" sub-views. The cheaper option is the second. Document the choice in the AAR. Estimated 1–2 days for the audit; implementation effort depends on decision.

**Workstream A duration:** ~2 weeks.

### Workstream B — Auto-compute pipeline (Commitment 2)

**Premise:** the embedded compute pathway in `classic-spread/route.ts` is correct (verified via PRECHECK on Samaritus today). The aggregator just needs to run automatically when its inputs are available, without banker action, and the Classic Spread PDF needs to be pre-rendered.

**B1 — Aggregator extraction.** Extract the embedded DSCR / ADS / CFA / ECF compute from `classic-spread/route.ts` into a standalone `runCashFlowAggregator(dealId, bankId)` module. Mirror the route's logic exactly. This is `SPEC-FOUNDATION-V1-PR4-EXTRACT` — already drafted. Estimated half day.

**B2 — Aggregator triggering.** Call `runCashFlowAggregator` automatically after `materializeFactsFromArtifacts` completes. Add a manual recompute endpoint for diagnostics. Preserve the trigger from the Classic Spread route for backwards compatibility, but make banker-click no longer required. Estimated 1–2 days.

**B3 — Classic Spread pre-rendering.** After fact materialization completes, generate the Classic Spread PDF as a background job (Cloud Run worker, same pattern as franchise-sync), store the PDF in GCS with a render-cache hash, make it available without banker click. The Classic Spread page becomes "view the existing PDF" with a "regenerate" option, not "click to generate." Estimated 1 week.

**B4 — Conservative methodology layer.** Stress A/B/C scenarios (already in `buildStressTestTable.ts`), worst-of-three living expense, owner W-2 conditional add-back, pro-rata affiliates, contingent liabilities. This is `SPEC-FOUNDATION-V1-PR4-METHODOLOGY` — already drafted. Estimated 3–5 sessions.

**B5 — Submission gate update.** Enforce conservative thresholds (1.20x base + 1.00x Stress C for SBA Small, scaling by loan path). This is `SPEC-FOUNDATION-V1-PR4-GATE` — already drafted. Estimated 1 session.

**Workstream B duration:** ~2–3 weeks.

### Workstream C — Readiness presence (Commitment 3)

**Premise:** the readiness contract already labels owners. The advisor panel already exists. What's missing is the live-progress framing for buddy-owned blockers and tighter inline-form treatment for banker-owned blockers.

**C1 — Live progress for buddy-owned blockers.** For each buddy-owned blocker, surface its current pipeline state: documents extracting (count of total), research running (seconds elapsed), DSCR computing (pending NCADS materialization), narrative generating (Gemini call in flight). The data exists in the ledger and in worker state; the UI doesn't surface it. New shared component: `BuddyProgressIndicator` that consumes blocker code + ledger state and renders the appropriate progress affordance.

**C2 — Inline forms for banker-owned blockers.** For each banker-owned blocker, expose the input form inline in the readiness panel rather than linking to a separate page. SPEC-06 already shipped this for conditions and overrides via `ConditionsInlineEditor` + `OverrideInlineEditor`. C2 extends the pattern to: loan amount entry, business description editor, principal bio editors, collateral description.

**C3 — DealShellMemoCta auto-refresh after submission.** Audit P1 finding. After successful submission, the CTA updates without a manual refresh. Mechanical fix.

**C4 — Real document counts in cockpit.** Friction F17. The "X of Y documents" affordance currently shows static or stale counts. Wire to live `deal_documents` query.

**C5 — Live status indicators that don't lie.** When a worker is running, show it. When a job is queued, show it. When something failed, show it. Replace silent `.catch(() => {})` patterns with user-visible error surfaces.

**Workstream C duration:** ~1–2 weeks.

### Workstream D — Display name canonicality (Commitment 4)

**Premise:** mechanical audit + replace + guard. No design decisions.

**D1 — UI surface audit.** Find every component in `src/components/` and `src/app/` that reads `borrower_name`, `name`, `legal_name`, or `entity_name` directly from a deal/borrower/entity row. Replace with `dealLabel()` resolution.

**D2 — Server-side renderer audit.** Find every PDF generator, email composer, voice-gateway prompt builder doing the same. Fix.

**D3 — CI guard.** Add a source-level test that greps for the disallowed field reads in `src/components/` and `src/app/`, asserts they only appear inside `dealLabel()` resolution helpers or an explicit allowlist (forms editing the underlying field).

**D4 — Backfill stale fixture data.** Samaritus's `deals.name` and `deals.borrower_name` still hold "ChatGPT Fix 15." Migration to clean this up. Same pattern for any other deal with fixture string contamination.

**Workstream D duration:** ~3–5 days.

### Workstream E — Honesty pass (Commitment 5)

**Premise:** aggressive deletion of decorative UI + tenant-isolation fixes + retired-route cleanup.

**E1 — Cosmetic UI deletion.** Delete `WorkstreamCard.tsx` and its uses in AnalystWorkbench. Delete or wire the deals-list search input (decision in audit). Delete `UnderwriteConsole.tsx` after confirming no imports. Delete `src/__disabled__/`. Audit `src/pages/` and delete if dead. Delete `page.tsx.stitch-backup` and any other backup files in source.

**E2 — Test script relocation.** Move root-level test scripts (`test-bank-routing.sh`, `test-borrower-portal-e2e.sh`, etc.) into `e2e/` or delete.

**E3 — Tenant-isolation holes.** Fix `/home` hardcoded `bankId="demo-bank"` (or delete `/home`). Add `ensureDealBankAccess` to `/spreads/page.tsx`. Fix or delete `/banker/dashboard` (audit P0 #1, no tenant filter). Fix or delete `/banker/deals/[dealId]/discovery` and `/banker/deals/[dealId]/memo` (audit P1 #8, orphaned).

**E4 — Retired-route cleanup.** Delete every route file that's been replaced by a redirect (the redirects themselves stay).

**E5 — Silent error surfacing.** Replace `.catch(() => {})` patterns with user-visible error states.

**Workstream E duration:** ~1 week.

### Workstream F — Borrower handoff frictionless

**Premise:** the borrower's experience for delivering documents is on the critical path for the banker's holy-shit moment. A banker chasing PDFs has a different Tuesday morning.

**F1 — Borrower portal experience audit.** The magic-link portal at `/portal/[token]` exists. Walk a borrower through document delivery and observe friction. Document specific gaps (upload status visibility, classification confirmation, follow-up document requests, error recovery).

**F2 — Autonomous document classification on the borrower side.** When a borrower uploads a document, classification runs immediately and the borrower sees the result before banker review. They can correct misclassification themselves. Existing classification pipeline (the AI classification you fixed in the entity-name-stamp work) extends to the portal surface.

**F3 — Banker requests additional documents through Buddy, not email.** When a Buddy-owned blocker says "missing balance sheet," the banker clicks an action that sends the borrower a magic-link request for that specific document. Borrower delivers through the portal. Document classifies. Fact materializes. Blocker clears. No banker-mediated upload step.

**F4 — Borrower-side status visibility.** Borrower sees what's been received, what's been processed, what's still needed. Mirror of the banker's readiness view, scoped to their deal.

**Workstream F duration:** ~1–2 weeks.

### Workstream G — Buddy presence (already mostly built)

**Premise:** `CockpitAdvisorPanel` (24KB) is the existing surface. SPEC-12.1 in Workstream A1 closes the trust-language gap. What remains is making the advisor feel like a *companion across the whole journey*, not just a panel inside the cockpit.

**G1 — Advisor presence in non-cockpit surfaces.** When a banker is on the financial spreads page, the credit memo page, or the Classic Spread PDF view, the advisor panel persists. Same data, same signals, same "Why this matters." The journey rail already persists; the advisor should too.

**G2 — Buddy Voice integration (deferred — note only).** The voice gateway (`pulse-voice-gateway` on Fly.io) and Side Buddy / BuddyPanel infrastructure exist but aren't wired into the canonical banker workspace. G2 is the integration point. Estimated multi-week if pursued; **explicitly deferred** to a parallel arc and not part of the holy-shit critical path. The reasoning: visual + textual advisor presence is sufficient for the holy-shit moment; voice is amplification.

**Workstream G duration (G1 only):** ~3–5 days.

### Workstream H — Holy-shit verification

**Premise:** none of this is "done" until a fresh never-hand-debugged deal walks the full surface and produces the reaction.

**H1 — Walk a fresh deal end-to-end.** Not Samaritus. Not OmniCare. A new test deal, created the day of the verification. Record the experience as a video or detailed walk-through. Observe at every step: what works, what surprises (good or bad), what friction remains.

**H2 — File any final findings.** Anything not anticipated by Workstreams A–G that emerges from H1 gets filed. Targeted fixes only — not scope creep.

**H3 — Decision: ship or iterate.** If H1 produces the reaction, the spec is done. If it doesn't, file the gap as a follow-up workstream and do not declare done.

**Workstream H duration:** 2–3 days for H1, variable for H2/H3.

---

## 7. Sequencing

The seven workstreams are not independent. Order minimizes rework and front-loads the highest-leverage UX wins.

**Phase 1 (week 1) — Substrate verification.**
- Workstream A1: Ship SPEC-12.1.
- Workstream A2: Verify SPEC-10/11 server-side, ship gaps.
- Workstream A3: Substrate completeness audit for canonical memo.
- Workstream A4: Cockpit/underwrite/credit-memo URL audit.

Verify at end of Phase 1: a banker on Samaritus sees "Very high confidence" instead of "85%", advisor "Why this matters" blocks render with deterministic explanations + evidence rows, and the substrate-completeness audit identifies any gaps blocking god-tier memo output for a fresh deal.

**Phase 2 (weeks 2–3) — Auto-compute substrate.**
- Workstream B1: Aggregator extraction.
- Workstream B2: Aggregator triggering.
- Workstream B3: Classic Spread pre-rendering.

Verify at end of Phase 2: a fresh deal auto-computes DSCR after fact materialization with no banker action, and the Classic Spread PDF is available on first paint when the banker opens the deal.

**Phase 3 (weeks 4) — Honesty + canonicality.**
- Workstream D: Display name canonicality (D1–D4 mechanical).
- Workstream E: Honesty pass (E1–E5 deletion + tenant-isolation fixes).

Verify at end of Phase 3: no surface shows "ChatGPT Fix 15" or other fixture strings, no cosmetic UI lies, no tenant-isolation holes.

**Phase 4 (weeks 5–6) — Readiness presence + advisor companion.**
- Workstream C: Live progress + inline forms + lying-status fixes.
- Workstream G1: Advisor presence on non-cockpit surfaces.

Verify at end of Phase 4: a banker walking through the workspace sees real-time Buddy progress on buddy-owned blockers, completes banker-owned blockers inline, and the advisor panel persists across all in-deal surfaces.

**Phase 5 (weeks 7–8) — Conservative methodology + borrower handoff.**
- Workstream B4: Conservative methodology layer.
- Workstream B5: Submission gate update.
- Workstream F: Borrower handoff (F1–F4).

Verify at end of Phase 5: DSCR is computed with stress scenarios, conservative gate enforces, bank policy override works, and a borrower can deliver follow-up documents through the portal without banker-mediated upload.

**Phase 6 (weeks 9) — Holy-shit verification.**
- Workstream H1: Fresh deal walk.
- Workstream H2: Final findings.
- Workstream H3: Ship-or-iterate decision.

**Total: 8–9 weeks of focused work.**

---

## 8. What governs existing work

This spec doesn't kill or override prior work. It frames it.

- **SPEC-FOUNDATION-V1 PR1 (orphaned principal_bio rekey):** shipped. Supports Workstream A and Commitment 4.
- **SPEC-FOUNDATION-V1 PR2 (collateral fallback):** shipped. Supports Commitment 2 — automatic compute should not depend on banker entering collateral facts.
- **SPEC-FOUNDATION-V1 PR3 (T12 audit):** still relevant, fits in Workstream B as a sub-task.
- **SPEC-FOUNDATION-V1 PR4 (originally "build aggregator"):** replaced by Workstream B (extract / trigger / methodology / gate). The original spec is preserved as historical reference.
- **SPEC-FOUNDATION-V1-PR4-PRECHECK:** the verification that unlocked Workstream B's revised scope. Done.
- **Friction addendum + audit findings (SPEC-WALKTHROUGH-CONVENTIONAL-V1):** every P0/P1/P2 maps to a workstream above (mostly E, some C and D).
- **Banker-journey-fluidity arc (SPEC-01 through SPEC-13):** the substrate. SPEC-12.1 is closed by Workstream A1. SPEC-10/11 server-side gaps closed by Workstream A2. Everything else governs as-shipped.
- **God-tier SBA deliverable system (Business Plan / Feasibility / Projections):** parallel arc, not governed by this spec.
- **Phase 81-92 canonical credit memo work (Florida Armory tuning):** verified god-tier. Workstream A3 verifies it produces god-tier output for a fresh deal.

When new specs are filed under any of these arcs, they reference this spec as governing.

---

## 9. Out of scope (deliberate)

This spec does **not** cover:

- **Visual design / Stitch refresh.** Visual treatment is downstream. The journey defined here is correct regardless of visual treatment.
- **The God-tier SBA borrower deliverables (Business Plan / Feasibility / Projections).** Parallel arc.
- **The SBA-specific eligibility / franchise certification flow.** Layered on top of the conventional flow defined here. SBA brokerage and SBA bank-side share the same institutional credit memo per project memory; the holy-shit experience for SBA is achieved via the same workspace + a thin SBA-eligibility layer (separate spec).
- **Multi-tenant credit policy admin UI.** Per-tenant policy configuration is scoped into Workstream B4 at the methodology level; the broader policy admin UI is a separate arc.
- **Buddy Voice / Side Buddy integration.** Workstream G2, explicitly deferred.
- **Crypto lending module.** Separate arc (Phase A → B → C per project memory).
- **Franchise Intelligence Slices 2–4.** Separate arc.
- **Three-systems unification implementation.** Separate arc, drafted but not in this spec.
- **Deal lifecycle continuity post-submission** (committee surface, underwriter feedback loop, conditions tracking, closing coordination, post-close monitoring). Massive scope; the holy-shit moment in this spec is the submission moment, not the months-long post-submission relationship. Naming this as out of scope is deliberate; the elite-tier post-submission experience is its own multi-month arc.

Each of the above has its own roadmap. This spec governs only the conventional banker workspace experience from intake to submission.

---

## 10. What "done" looks like

Done is when a banker who has never used Buddy before:

1. Creates a new deal in under 30 seconds.
2. Sees Buddy actively working on the deal in the canonical workspace, with live progress on buddy-owned blockers.
3. Provides their three inputs without leaving that workspace.
4. Watches the readiness panel go green over the next several minutes (not hours).
5. Reviews the auto-generated canonical credit memo (committee-grade prose), the pre-rendered Classic Spread PDF, the ratio analysis with deal-specific interpretations, and the advisor's "Why this matters" blocks for any predictive warnings.
6. Clicks submit.
7. Sees the deal advance with no surprises.
8. Says, unprompted, *"holy shit."*

That last item is non-negotiable. If the experience doesn't earn that reaction from someone who hasn't been hand-holding the deal, the spec isn't done.

---

## 11. Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Workstream A4 reveals more cockpit/underwrite/credit-memo entanglement than expected | A4 is an audit; if implementation effort balloons, drop to "accept three URLs with persistent rail" and surface as you-are-here sub-views. Cheaper option, still satisfies Commitment 1. |
| 2 | Workstream B3 (Classic Spread pre-rendering) hits PDF rendering complexity | The render path already exists for on-demand generation. B3 is moving the trigger and adding caching, not building the renderer. If complexity emerges, defer to Phase 5. |
| 3 | Workstream A3 (substrate completeness audit) reveals canonical memo gaps that require methodology rework | Scope was shrunk in Path 1 verification. If A3 finds material gaps, file them as targeted fixes inside Workstream B (compute substrate), not as memo-system rework. |
| 4 | SPEC-10/11 server-side surface (Workstream A2) reveals more unshipped work than expected | A2 is bounded at 2–4 days; if more is needed, file the gap as a separate workstream and do not block Phase 2 on it. The advisor client surface works without server-side persistence — it just degrades to localStorage. |
| 5 | Workstream F (borrower handoff) reveals deeper portal infrastructure gaps | F is the most uncertain workstream. If F1 audit reveals architectural gaps, scope F to "fix the highest-friction handoff path" and defer the rest to a parallel borrower-experience arc. The holy-shit moment for the banker survives a partial F. |
| 6 | Workstream H verification fails the unprompted-reaction bar | H3 explicitly handles this — file the gap, don't declare done. The spec has no ego. |
| 7 | New friction findings emerge during Phases 1–5 that aren't covered by any workstream | Every workstream has slack for in-flight findings if they're targeted. If a finding is structural, file it as a follow-up spec and don't scope-creep this one. |

---

## 12. Hand-off commit message

When Claude Code commits this spec to `main`:

```
spec(banker-experience): SPEC-BANKER-HOLY-SHIT-V1 north star

Defines the elite-tier banker experience as a target state and sequences
the work to deliver it. Subordinates SPEC-FOUNDATION-V1 PR3/PR4 work and
all friction-addendum findings into a single arc with a clear destination.

Names what's already shipped (banker-journey-fluidity SPEC-01–13 less
SPEC-12.1; canonical credit memo Phase 81–92), what's the gap (SPEC-12.1
trust language; auto-compute; readiness presence; canonicality;
honesty pass; borrower handoff), and what governs existing work.

Bar: "holy shit, this changed my life" reaction from a banker walking a
fresh, never-hand-debugged deal.

Sequencing: 6 phases, 8–9 weeks of focused work.
```

---

## 13. Addendum for Claude Code

**Critical reminders when this spec hands off to Claude Code or governs sub-PRs:**

1. **Read the substrate fresh before writing anything.** This spec assumes shipped state as of 2026-05-08. If any load-bearing infrastructure has changed (journey rail, advisor panel, canonical memo builder, lifecycle engine), reconcile against the actual code, not this spec.

2. **Do not modify the lifecycle engine.** `src/buddy/lifecycle/*` is the contract every workstream consumes. Changes to that engine are out of scope for any sub-PR governed by this spec.

3. **Do not modify the canonical credit memo system.** `src/lib/creditMemo/canonical/*` is god-tier as shipped. Workstream A3 is *verification*, not rework. If A3 finds gaps, file them as upstream substrate fixes (Workstream B), never as memo-system changes.

4. **Do not modify `narrativeAssembly.ts`.** The 50-line system prompt was tuned with Matt and ChatGPT over a full day. It is committee-grade. Workstream A1 ships SPEC-12.1 trust-language UI changes, not narrative-prompt changes.

5. **Every sub-PR commits its spec to `specs/` before implementation.** No chat-only specs. Format follows the project's standard: PIV → scope → tests → V-N verification → non-goals → risk register → hand-off commit message → addendum.

6. **Verify Claude Code AARs against GitHub before accepting.** Phantom commits are a recurring pattern. Re-verify key files on `main` via GitHub read after every AAR.

7. **The Samaritus test deal `0279ed32-c25c-4919-b231-5790050331dd` remains the canonical reference until Workstream H.** Workstream H deliberately uses a fresh deal to test the experience without hand-debug bias. Do not use Samaritus for H1.

8. **Tenant isolation is foundational.** Every new endpoint, every new query, every new component that fetches data enforces bank-scoped access. The Buddy/Omega Prime architectural rule (Buddy owns canonical state; Omega advisory only; tenant data isolation per GLBA) is non-negotiable.

9. **Build principles #11 (error-spreads-as-warning), #12 (placeholder-borrower-on-banker-upload), #13 (terminal-cleanups-don't-change-scope) apply to every sub-PR under this spec.** They're load-bearing.

10. **The bar is "holy shit" from a fresh banker, not "the architecture is clean."** Architecture is a means. The reaction is the end. If a workstream produces clean architecture but doesn't move the needle on the reaction, it's wrong.
