# Buddy Research System — Full Audit (Reliability + God-Tier Roadmap)

**Auditor**: Claude (Sonnet 5), 6 parallel deep-dive subagents
**Date**: 2026-07-12

---

## Remediation status (2026-07-12, same-day follow-up)

All 6 P0 items and all 9 tracked P1 items below were fixed, tested, and
pushed to this branch in the commits following this audit. Summary:

**P0 — fixed:**
- P0-1 (cross-tenant auth gaps): `ensureDealBankAccess` / authenticated
  ownership checks added to every research route that was missing one.
- P0-2 (no rate limiting): per-deal/per-bank cooldowns added to every
  mission-triggering endpoint, including the borrower-portal one.
- P0-3 (no hallucination guard on Litigation and Risk): extended the
  Management Intelligence scrub pattern to Borrower Profile/Litigation and
  Risk, keyed off the deterministic `wrong_entity_risk` classification.
- P0-4 (classifyEntity mismatch-check bypass): the name-mismatch check now
  runs unconditionally, not gated to the `[0.5, 0.7)` confidence band.
- P0-5 (dropped SPEC-13.6 investigation): root-caused to a dead threshold
  (`THRESHOLDS.preliminary.min_entity_confidence` was declared but never
  read) — fixed in completionGate.ts's grade-assignment branch.
- P0-6 (fake memo-research stub): replaced with an authenticated, honest
  `not_implemented` response.

**P1 — fixed:** mission idempotency (`run_key` end-to-end), `ingestSource.ts`
routed through the already-built retrying/allowlisted `fetchSource()` (plus
~25 registry entries added to cover domains `sourceDiscovery.ts` actually
fetches), degraded-output signaling on empty missions, unconditional
degraded quality-gate writes on BIE/trust-layer exceptions, stale-mission
sweep wired into the worker-tick job, governance registry enforcement moved
into `runMission()` itself, adverse-screen made a hard `committee_eligible`
requirement (with per-thread litigation source attribution instead of the
whole-mission pool), fallback-thread discounting in thread-coverage,
zero-source claims no longer counted as evidence coverage (+ new test file —
this module had none), 9 previously-dead bracket-path test files reactivated
(54 tests) via a `discover-tests.mjs` fix, the `yacht-charter-regression`
golden-set case's accidental self-exclusion fixed, the golden-set eval wired
into CI, and JSON-repair/timeout/token-limit/model-retirement-diagnostic
hardening extended to all 6 grounded BIE threads (previously only
`management` had it).

Full repo test suite: 11187/11197 pass (was 11168/11178 before this pass),
with the one remaining failure confirmed pre-existing and unrelated (present
identically on the unmodified branch).

**Deliberately deferred at the time** — resolved in a second follow-up pass
the same day (see "Round 2" below), except where noted otherwise.

---

## Round 2 remediation status (2026-07-12, second same-day follow-up)

All items deferred above were revisited. Five were implemented; two were
investigated and deliberately NOT implemented, with the reasoning recorded
here rather than silently skipped.

**Implemented:**
- **verification.ts / provenance.ts wired.** `runMission.ts` now calls
  `runVerification`/`persistVerificationEvidence` (source hygiene,
  corroboration, freshness, contradiction, usability checks) and
  `generateProvenanceReport` (source-trust → fact/inference confidence
  chain) against the legacy pipeline's own sources/facts/inferences, which
  are already in scope at that point in `runMission.ts`. Wired additively —
  new diagnostic `buddy_research_evidence` rows only; does not mutate the
  stored fact/inference confidence values that other consumers
  (`compileNarrative`, `flagFromResearchInferences`) read, to avoid silently
  shifting calibrated thresholds.
- **Claim source URLs are now snapshotted.** `claimLedger.ts` resolves,
  hashes, and records a bounded set (top 20, prioritizing Litigation and
  Risk / Borrower Profile / Management Intelligence / Entity Identification)
  of each mission's claim source URLs via the existing `fetchUrlSnapshot`
  connector, at limited concurrency, attaching `content_hash`/`http_status`/
  `byte_size` onto each claim's `supporting_data.source_snapshots`.
  Best-effort and non-fatal — never a gate input, never blocks mission
  completion.
- **Real cross-thread numeric diffing for `scale_plausibility`.** Added
  `extractMentionedRevenueFigures()` (regex-based dollar-figure extraction)
  and wired it to diff the loan-file/banker-stated annual revenue against
  figures the borrower thread's own narrative actually mentions — a >5x
  magnitude mismatch is now a real, cited committee blocker instead of a
  presence-only "consistent" claim. `repayment_story_conflict` was left
  self-report-based (DSCR-style figures aren't reliably extractable from
  transaction-thread prose the way revenue is — a numeric diff there risked
  false positives more than it added signal).
- **Model-fallback retry on likely-retirement 404.** Added
  `MODEL_RESEARCH_FALLBACK` (`gemini-3.5-flash`, already GA-validated
  elsewhere in this codebase) to the model registry; `callGeminiGrounded()`
  now retries once against it when the primary model 404s, guarded against
  retrying the fallback's own 404.
- **Per-claim confidence weighted by that claim's own source trust.** Added
  `weightConfidenceBySourceTrust()`, blending each claim's base confidence
  with `computeSourceQualityScore()` of that specific claim's sources
  (discount-only, never boosts above the base — same direction as
  `provenance.ts`'s existing `adjusted_confidence <= original_confidence`).
  A zero-source claim (Credit Thesis, Contradictions, Underwriting
  Questions — always empty `source_uris` by construction) is now discounted
  to half its base confidence instead of carrying the full section
  confidence.

**Investigated, deliberately NOT implemented:**
- **`brieRuntime.ts`'s checkpoint/retry/heartbeat system** — neither wired
  in nor deleted. Discovered its resume path is currently broken, not just
  idle: `executeBrieMission()` passes `resumeFromStage` to the injected
  `runMission` callback, but the real `runMission()`'s options type has no
  such field and never branches on one — a genuine architectural rewrite of
  `runMission.ts`'s sequential pipeline into a resumable stage machine,
  not a bounded fix, and not something to do silently as part of an audit
  remediation pass. Added loud top-of-file "NOT WIRED" warnings to
  `brieRuntime.ts`, `checkpoint.ts`, `threadRuns.ts`, and `failureLibrary.ts`
  instead, stating plainly which exports are live (`checkpoint.ts`'s
  `findStaleMissions`, used by `staleMissionSweep.ts`) vs. fully orphaned.
- **A real gate re-evaluation trigger on committee task resolution** — on
  inspection, `evaluateCompletionGate` doesn't take committee-task state as
  an input at all (it scores BIE research output, not human review
  progress), so "re-run the gate when a task is resolved" doesn't apply
  literally. More importantly, the codebase has multiple explicit, tested
  invariants against automatic gate mutation:
  `committeeTaskReview.ts`'s docstring states it "NEVER changes trust_grade
  ... NEVER clears a committee blocker," and `applyCommitteeReadinessTransition`
  is permanently disabled and pinned as such by
  `committeeReadinessFinalization.test.ts`. The live preview/transition
  layer (`buildResearchQualityPayload.ts`) already recomputes fresh on every
  read, so the "staleness" concern is narrower than originally framed — it's
  the *persisted* `trust_grade` that's frozen, not the banker-facing preview.
  Building automatic mutation here — even a downgrade-only version — would
  override a deliberate, repeated safety decision without the standing to
  make that call unilaterally. Left for the team to decide explicitly.

**Still deferred** (unchanged from the first pass, not revisited this
round):
- Real external alerting/paging on BIE/trust-layer exceptions — this
  environment has no PagerDuty/Slack/etc. webhook configured to wire into;
  those failures are loud in logs and queryable in the DB (`writeDegradedQualityGate`),
  but not yet pushed to an external on-call channel.

Full repo test suite after round 2: 11196/11206 pass, same single
pre-existing unrelated failure as round 1 (confirmed present identically on
the unmodified branch). Research-specific suite: 576/576 pass.

## Round 3 — citation precision (2026-07-12, third same-day follow-up)

Beyond the P0/P1 punch list, the highest-leverage remaining improvement was
**per-segment citation precision**: every sentence/claim in a BIE narrative
section previously carried the *entire thread's* pooled source list, not
just the sources that actually supported that specific sentence. A
Litigation and Risk claim could be "backed" by a source that in reality only
supported an unrelated Company Overview sentence — auditable in the sense
that sources were attached, but not trustworthy at the individual-claim
level a committee reviewer or examiner would need.

**Implemented:**
- **`GroundingSegment`/`thread_segments` threaded through `BIEResult`.**
  Gemini's grounding metadata already returns `groundingSupports` — a
  per-text-segment mapping to the specific source chunk(s) that ground it —
  alongside the coarser `groundingChunks` (source URL list) that was the
  only thing previously captured. All 6 grounded threads (entity_lock,
  borrower, management, competitive, market, industry) now also return
  `segments: GroundingSegment[]`, exposed on `BIEResult.thread_segments`.
- **`citationAttribution.ts`** — new pure module (`attributeSegmentsToText`):
  normalizes a claim/sentence's text and each segment's text, matches by
  substring overlap (segments under 20 chars are ignored as too generic to
  be a reliable match), and returns the union of matched segment URLs — or
  the thread-wide pooled list as a fallback when no segment matches (never
  silently drops citations; a match failure degrades to the old
  thread-pooled behavior, not to zero sources).
- **Wired into both narrative sentences and claim-ledger rows.**
  `buildBIENarrativeSections()`'s `addSection()` now attributes each
  sentence's citations independently instead of reusing one thread-wide
  citation list for every sentence in a section (including the
  Management Intelligence per-profile sentence builder, previously a
  separate manual code path). `claimLedger.ts`'s `makeClaimRecords()` and
  the manual competitor-claim construction do the same for `source_uris`/
  `source_types`/`confidence` on every persisted claim row — so a claim's
  confidence weighting (`weightConfidenceBySourceTrust`) now reflects the
  trust of the sources that actually ground *that claim*, not the thread's
  best or worst source diluting every claim equally.

Regression coverage added: `citationAttribution.test.ts` (6 cases on the
pure matcher), `narrativeSectionAttribution.test.ts` (2 cases proving two
sentences in the same section get different, correctly-scoped citations),
`claimLedgerCitationAttribution.test.ts` (2 cases proving a Litigation and
Risk claim and a Recent News claim in the same borrower thread no longer
share each other's sources).

Full repo test suite after round 3: 11206/11216 pass (9 skipped), same
single pre-existing unrelated failure (`src/lib/deals/__tests__/lifecycleInvariants.test.ts`,
"banker upload ignites deal" — confirmed present identically via `git stash`
on the unmodified branch, unrelated to the research system). Research-specific
suite: 586/586 pass.

## Round 4 — resumable missions + failure learning (2026-07-13)

User request: "the mission should be able to continue and more importantly
learn from the failure so that it does not happen again, plus be able to
continue." This is exactly the gap rounds 1–2 identified and deliberately
left open: `checkpoint.ts`, `threadRuns.ts`, `failureLibrary.ts`, and
`brieRuntime.ts` (Phase 66A's "Buddy Resumable Intelligence Engine") existed
fully built and tested but had **zero production callers** — a failed
mission always restarted from scratch (re-fetching every source, re-running
all 8 BIE Gemini threads even the ones that had already succeeded) and
nothing about *why* it failed was ever recorded. The blocker at the time:
wiring this in for real meant turning `runMission.ts`'s straight-line
pipeline into a resumable stage machine — a genuine architectural change.
That's what this round does.

**Implemented:**
- **Mission-row reuse on retry.** `checkExistingMission()` only ever matched
  `queued`/`running`/`complete` for a `run_key` — a `failed` mission was
  invisible to it, so every retry created a brand-new mission row. Added
  `findFailedMissionForRunKey()`/`resumeFailedMission()`: a retry of a
  previously-failed `run_key` now reuses that mission's id (`status:
  failed → running`, `attempt_count` incremented) instead of starting over,
  unless the caller passes `forceRerun`.
- **Real per-stage checkpoint/resume**, using `checkpoint.ts`'s existing
  `saveCheckpoint()`/`getResumeDecision()` and `CheckpointStage` enum (which
  already mapped 1:1 onto `runMission.ts`'s actual steps —
  `source_discovery`/`source_ingestion`/`fact_extraction`/
  `inference_derivation`/`narrative_compilation`/`bie_enrichment`/
  `gap_analysis`/`flag_bridging`). On resume, a stage already checkpointed
  as complete is skipped and its output reloaded from the canonical table
  (`buddy_research_sources`/`facts`/`inferences`) instead of recomputed —
  necessary for *correctness*, not just speed: `persistSources`/
  `persistFacts`/`persistInferences` are plain inserts, not upserts, so
  re-running an already-completed stage on resume would have silently
  duplicated every row.
- **BIE is now resumable per-thread**, not just skippable as a whole unit.
  `runBuddyIntelligenceEngine()` gained an optional `previousThreadResults`
  param and a new pure `bieThreadReuse.ts` (`planBIEThreadReuse`) encoding
  the actual dependency graph between the 8 threads (`entity_lock` has no
  deps; `borrower`/`management`/`competitive` depend on `entity_lock`;
  `market`/`industry` are independent; `transaction` depends on all five;
  `synthesis` depends on everything including `transaction`) — a thread is
  only reused if it previously succeeded **and** every thread whose output
  feeds its prompt is also being reused this round, never a thread whose
  upstream input just changed. `runMission.ts` checkpoints BIE's raw
  per-thread output (`extractBieThreadResults()`) immediately after every
  run — before the hallucination guard/narrative-upsert/claim-ledger/gate
  steps that follow have a chance to throw — and again with a
  `gate_and_claims_persisted: true` flag once that entire block finishes,
  so a resume can tell "reuse some threads" from "skip the whole stage,
  it's already fully done." This also happens to be the only place BIE's
  raw structured output survives at all — everything else downstream only
  ever sees merged, hallucination-guard-scrubbed prose.
- **In-process thread retry** — the fastest, most common "continue" win.
  `isRetryableBIEDiagnostic()` classifies which failure categories are
  worth one immediate same-invocation retry (`network_error`,
  `empty_candidate`/`empty_text`, `http_error` with 429/408/5xx/no status)
  versus which aren't (`safety_block`, `json_parse_error` — a same-prompt
  retry is unlikely to change a content-policy refusal or a
  systematically malformed response that already went through a repair
  pass). A single flaky Gemini call no longer permanently degrades that
  thread for the whole mission.
- **Failure library wired for real** — the "learn" half. `recordFailure()`
  is now called for every genuine source-fetch failure (with domain, for
  cooldown tracking) and every non-ok BIE thread diagnostic (via new
  `mapBIEErrorTypeToFailureCategory()`, which uses the thread diagnostic's
  already-structured `error_type`/`http_status` instead of re-deriving a
  category from a raw message string — strictly more precise).
  `getActiveCooldownDomains()` (new, one bulk query) is consulted before
  source ingestion: a domain that recently failed with a rate-limit/
  unavailable pattern is skipped proactively — still persisted as an
  explained skip (`fetch_error: "domain_in_cooldown: <domain>"`), just
  without wasting another network call repeating a failure the system
  already knows about.
- **`brieRuntime.ts` deleted.** Its role (idempotency + checkpoint
  orchestration + retry loop wrapping an injected `runMission`) is now
  implemented for real, directly in `runMission.ts` — the same pattern
  already used for idempotency and governance in earlier rounds, and the
  approach rounds 1–2 explicitly favored over reviving this file's more
  complex wrapper design. It had zero production callers before and its
  logic is now fully duplicated, not just unused, so keeping it would be
  pure clutter. `phase66aGuard.test.ts`'s Guard 4 ("BRIE wraps runMission")
  tested an architecture that no longer exists — replaced with an
  equivalent guard on the real wiring (`saveCheckpoint`/`getResumeDecision`/
  `recordFailure`/`findFailedMissionForRunKey` actually present in
  `runMission.ts`). `checkpoint.ts`, `threadRuns.ts`, `failureLibrary.ts`'s
  "NOT WIRED" banners updated to describe their real call sites;
  `stages/index.ts` (a metadata-only stage registry) got one added since it
  remains genuinely unused — nothing needed its `dependsOn`/`resumable`
  metadata once resume was implemented directly against
  `getResumeDecision()`'s own `completedStages` list.

**Scope decisions, stated rather than silently narrowed:**
- `threadRuns.ts`'s `createThreadRun`/`completeThreadRun`/`failThreadRun`
  are wired for the `source_ingestion` stage only (the genuinely
  failure-prone, network-bound one where timing/error data has real value).
  The other legacy-pipeline stages (`fact_extraction`,
  `inference_derivation`, `narrative_compilation`) have early-return error
  paths inline with the mission's own control flow; wrapping them would
  have required restructuring those returns into thrown exceptions purely
  for observability on stages that are fast, synchronous, and already
  checkpointed with a summary. Per-BIE-thread `threadRuns` rows were
  deliberately not added either — `buddyIntelligenceEngine.ts` has no
  Supabase dependency today (by design, kept that way in this round too),
  and `thread_diagnostics` already gives equivalent-or-richer per-thread
  detail without adding one.
- Failure-library lookups (`getKnownFailures`) are consulted for the
  source-domain cooldown case, but the in-process BIE thread retry (§ above)
  does **not** consult failure history before its one immediate retry —
  a single retry happening milliseconds after the first attempt, within the
  same mission, can't yet have "many recent occurrences" to check against;
  that signal only becomes meaningful across many past missions, which is
  exactly the cross-invocation cooldown case that *is* wired.
- Claim-ledger persistence (`persistClaimLedger`) is not fully idempotent —
  it inserts rows rather than upserting by a natural key. In the narrow
  case where it partially inserts rows and then genuinely throws (a JS
  exception, not a normal Postgrest error return, which it already handles
  gracefully) before the `bie_enrichment` stage's completion checkpoint is
  saved, a resumed retry could re-insert those rows. Judged low-probability
  and out of scope for this round; making it upsert-safe is a claim-ledger
  change unrelated to resumability and would need its own review.

Regression coverage added: `bieThreadReuse.test.ts` (6 cases on the
dependency-aware reuse planner — the highest-risk logic in this round),
`bieRetryPredicate.test.ts` (5 cases on which failure categories qualify
for in-process retry), `extractBieThreadResults.test.ts` (3 cases on the
BIEResult → checkpoint-cache mapping), `failureLibraryCooldown.test.ts`
(5 cases on cooldown-window math and BIE error-category mapping), plus
`phase66aGuard.test.ts`'s rewritten Guard 4.

Full repo test suite after round 4: 11226/11236 pass (9 skipped), same
single pre-existing unrelated failure as every prior round (confirmed via
the same file/test name, `lifecycleInvariants.test.ts`'s "banker upload
ignites deal"). Research-specific suite: 606/606 pass.

## Round 5 — closing the open items (2026-07-13)

User request, in response to "is this system ready for deployment": "please
make all of the corrections and improvements you have stated above." That
answer had listed five concrete gaps — no external alerting, a claim-ledger
idempotency edge case, `repayment_story_conflict` still self-report-based,
`threadRuns` observability limited to one stage, and the one pre-existing
unrelated test failure carried forward unfixed since round 1. All five are
closed this round.

**Implemented:**
- **Real external alerting.** Round 2 stated "this environment has no
  PagerDuty/Slack/etc. webhook configured to wire into" — re-investigated
  this round and found that's no longer accurate repo-wide: two working
  Slack webhook integrations already exist in production
  (`src/lib/observability/sendBankerAnalysisAlert.ts`,
  `src/lib/brokerage/commsAdapters.ts`), both reading `SLACK_WEBHOOK_URL`
  and no-oping safely if it's unset. New `researchAlerts.ts`
  (`sendResearchCriticalAlert`) reuses that exact pattern — same
  cooldown-dedup design via `buddy_system_events`, same fail-safe posture —
  and is called from `writeDegradedQualityGate()`, the single point every
  degraded-mission code path in `runMission.ts` already routes through (BIE
  exceptions, trust-layer exceptions, subject-lock failures, stale-mission
  sweeps). No new credentials are required to deploy this — only to
  activate it, by setting `SLACK_WEBHOOK_URL`.
- **Claim-ledger idempotency.** `persistClaimLedger` now deletes this
  mission's existing claim-ledger rows (`buddy_research_evidence` where
  `thread_origin IS NOT NULL` — scoped to not touch the separate
  verification/provenance summary rows in the same table) before inserting
  the current claim set. Closes the round-4-documented partial-insert-then-
  crash duplication risk directly, rather than leaving it as an accepted
  limitation.
- **Real numeric diffing for `repayment_story_conflict`.** Round 2
  deliberately left this self-report-based, reasoning that DSCR-*ratio*
  extraction from prose was too unreliable. That reasoning holds — this
  round doesn't extract ratios. Instead it reuses the same dollar-*figure*
  extraction already proven for `scale_plausibility`
  (`extractMentionedRevenueFigures`), applied to the TRANSACTION thread's
  own repayment narrative instead of the borrower thread's — a materially
  different check that catches a transaction thread whose repayment
  assumptions imply a different scale of business than the loan file
  states, independent of whether the borrower thread's own scale claim
  passes.
- **`threadRuns` observability extended** to `fact_extraction`,
  `inference_derivation`, and `narrative_compilation` (previously
  `source_ingestion` only), via manual `createThreadRun`/`completeThreadRun`/
  `failThreadRun` calls at each stage's existing entry/exit points rather
  than restructuring their inline early-return error paths into thrown
  exceptions. `bie_enrichment`/`gap_analysis`/`flag_bridging`/
  `source_discovery` remain untracked by design (see round 4's reasoning,
  still valid) — `threadRuns.ts`'s docstring corrected to state this
  precisely (it had drifted to claim "all 8 stages" during round 4, which
  was never actually true).
- **The pre-existing test failure is fixed**, not just repeatedly confirmed
  unrelated. Root cause: `lifecycleInvariants.test.ts`'s hand-rolled fake
  Supabase client never seeded a `borrowers` table and its `insert()` mock
  didn't support `.select().single()` chaining — both gaps opened after
  `igniteDealCore.ts`'s IGNITE-BORROWER-LINKAGE step (a real,
  already-non-fatal production code path) was added later without the test
  fixture being updated. Fixed the fixture: `borrowers` is now seeded (empty
  by default), and `insert()` returns a chainable *and* directly-awaitable
  ("thenable") builder matching the real Supabase JS client's behavior.

Regression coverage added: `researchAlerts.test.ts` (5 cases — happy path,
missing webhook, cooldown dedup, cross-mission non-interference, Slack
failure), 4 new `repayment_story_conflict` cases in
`contradictionChecklist.test.ts` mirroring the existing `scale_plausibility`
coverage.

Full repo test suite after round 5: **11236/11236 pass, 0 failures** (9
skipped) — the first fully green run across every round of this audit.
Research-specific suite: 615/615 pass.

---
**Scope**: The entire research system — mission orchestration (`runMission.ts`), the
Buddy Intelligence Engine (`buddyIntelligenceEngine.ts`, 8-thread Gemini-grounded
pipeline), the evidence/claim-ledger/provenance layer, the completion-gate/trust-grade
system, committee evidence workflow, the API surface, memo integration, and the
test/eval harness.

**Method**: six independent agents each read the actual source files in full (not
summaries), cross-referenced call sites via grep to confirm what's genuinely wired up
vs. dead code, ran the real test suite, and cited every finding to `file:line`. This
document synthesizes their findings, removes duplication, and orders everything by
severity and by what it takes to close the gap.

---

## How to read this document

- **P0** = fix now. Either a live security/compliance exposure, or a defect that lets
  bad output reach a banker/borrower with no signal anything went wrong.
- **P1** = fix soon. Real reliability or trust-integrity gaps that are contained today
  by a secondary control, or that degrade quality/auditability without being
  immediately catastrophic.
- **P2 / God-tier** = the system already works; these are the investments that would
  take it from "works, mostly fails safe" to genuinely institutional-grade and
  bulletproof.

Overall verdict up front: **the design intent of this system is unusually rigorous**
for a research pipeline — entity-lock disambiguation, per-thread diagnostics, a
deterministic completion gate, hallucination guards, claim ledgers, contradiction
checklists. The core problem found repeatedly across all six audits is not "the ideas
are wrong," it's that **a large fraction of the hardening machinery that was built is
not actually wired into the path that runs in production** — idempotency, retries,
checkpoints, source verification, provenance chains, and even one governance check all
exist, are unit-tested in isolation, and are never called. Closing that gap — wiring up
what's already been built — is the single highest-leverage thing this system can do.

---

## P0 — Fix now

### P0-1. [SECURITY] Cross-tenant data leakage and unauthenticated billable mission triggering
This is the most severe finding in the audit and should be treated as a live incident,
not a backlog item, for a multi-tenant lending platform.

- **`src/app/api/deals/[dealId]/research/[action=run]/_handlers/run.ts:54-126`** — the
  handler that actually triggers a real, up-to-300-second, 7-Gemini-call research
  mission never calls `ensureDealBankAccess(dealId)`, unlike 7 of its 8 sibling
  handlers in the same directory (`evidence.ts:29`, `flight-deck.ts:50`, `quality.ts:15`,
  `sourceArtifact.ts:25`, `sourceSnapshot.ts:40`, `collectIndustrySource.ts:33`,
  `committeeTaskReview.ts:42`). It resolves only the *caller's own* bank id
  (`getCurrentBankId()`, line 102) and never compares it to `deal.bank_id`. **Any
  authenticated banker at any bank can trigger research on any other bank's deal**, and
  the resulting mission is persisted tagged with the caller's own `bank_id` (line 124)
  — so a bank's own mission history ends up containing another institution's
  confidential borrower research.
- **`src/app/api/deals/[dealId]/research/[action]/_handlers/diagnostics.ts:78-99`** —
  same gap: no `ensureDealBankAccess`. Returns another bank's last 5 missions, 20
  sources, 20 degraded events, and a full support dump to anyone who knows a `dealId`.
- **`src/app/api/research/start/route.ts:104-139`** — auth is optional (no
  early-return on `user === null`), and even when a user is resolved, `bankId` is
  computed from the caller's profile and then **discarded** — `runMission()` is called
  with `deal.bank_id` (the target's bank), not the caller's, with no comparison
  anywhere in the file.
- **`src/app/api/research/planner/evaluate/route.ts:52-86`** — zero auth check at all.
  Any unauthenticated caller can `POST {"deal_id": "<any-uuid>"}` and cause a real,
  billable Gemini mission to run (planner defaults `auto_approve`/`auto_execute` to
  `true`, `runPlanner.ts:31,290,334`), repeatably, with no cooldown.
- **`src/app/api/research/[missionId]/route.ts`, `export/route.ts`,
  `explainability/route.ts`** — no auth/ownership check; full mission data (facts,
  narrative, PDF/DOCX export) is returned to anyone who can guess/observe a mission
  UUID (which is not treated as a secret — it appears in UI, browser history, and the
  unauthenticated `/start` response body).
- **Root cause**: there is no Next.js `middleware.ts` anywhere in the repo — auth is
  entirely per-route, and the legacy `/api/research/*` namespace predates the Clerk
  migration (it still uses a `createSupabaseServerClient().auth.getUser()` bridge,
  `src/lib/supabase/server.ts:67-92`, while 145+ other routes use `clerkAuth`).

**Fix**: add `ensureDealBankAccess(dealId)` to `run.ts` and `diagnostics.ts` (matches
the pattern already used by 7 sibling handlers — this is a small, mechanical fix).
Retire or rebuild the legacy `/api/research/*` namespace on the same auth pattern as
`_handlers/`, and in every mission-trigger route compare the *caller's* bank to the
deal's bank rather than trusting a client-supplied or deal-derived bank id.

### P0-2. [SECURITY] No rate limiting / abuse control on any mission-triggering endpoint
Every endpoint above that starts a real Gemini mission has no per-user, per-bank, or
per-deal rate limit — the only guard anywhere is "skip if a mission is already
`queued`/`running` for this deal" (`run.ts:104-119`), which does nothing to stop rapid
*sequential* re-triggering, and nothing at all on `/api/research/start` or
`/planner/evaluate`. Combined with P0-1, this is both a cost-DoS vector and a
cross-tenant abuse vector.
**Fix**: add a per-`(bank_id, deal_id)` cooldown, and change `evaluate/route.ts`'s
`auto_execute` default to `false` for unauthenticated-reachable paths.

### P0-3. [HALLUCINATION GUARD GAP] Litigation/adverse-event claims have no hallucination guard — only "Management Intelligence" is scrubbed
`src/lib/research/runMission.ts:495-575` implements the *only* hallucination guard in
the entire pipeline: it scrubs the "Management Intelligence" / "Monitoring Triggers"
sections if no known principal's last name appears in the generated text (a real,
well-designed defense against the LLM grounding onto a similarly-named company's
executives). But `buildBIENarrativeSections`
(`src/lib/research/buddyIntelligenceEngine.ts:1547-1557`) emits **"Litigation and
Risk"** from `borrower.litigation_and_risk` with **no equivalent guard** — the section
most likely to contain a defamatory, borrower-damaging false claim if the model
grounds onto the wrong entity is the one with zero code-level protection. The
low-confidence caveat that does exist (`entityNote`, lines 1549-1554) is attached only
to the Borrower Profile section, not to Litigation and Risk, which is emitted
separately with no caveat at all.
**Fix**: extend the exact same last-name/token-match scrub already built for
Management Intelligence to Borrower Profile / Litigation and Risk, keyed off
`company_search_name`/`legal_name`/`dba` instead of principal names. Do not rely on
Thread 7's "final validation pass" — that's the same model grading its own work, not
independent verification.

### P0-4. [ENTITY LOCK BYPASS] `classifyEntity()` skips its own name-mismatch check exactly when it matters most
`src/lib/research/buddyIntelligenceEngine.ts:604-614`:
```ts
if (modelConfidence >= 0.7) {
  return { classification: "confirmed_public_entity", confidence: modelConfidence };
}
// tokensOverlap name-mismatch check only runs below this line, i.e. only for 0.5–0.69
```
The token-overlap disambiguation check — the mechanism that's supposed to catch "the
model locked onto a real but different company" — only executes when confidence is
between 0.5 and 0.69. At `>= 0.7`, the single most-trusted confidence tier, the
mismatch check is **never run**. LLMs are known to self-report high confidence
precisely when they've confidently grounded onto the wrong (but real, similarly-named)
entity — this is the exact scenario the entity lock exists to catch, and the highest
confidence band is where it's structurally impossible to catch it.
**Fix**: run `tokensOverlap` unconditionally before the confidence branch, not gated to
a mid-range band.

### P0-5. [DROPPED INVESTIGATION] A live deal scored `quality_score=0` / `gate_passed=false` two months ago and the follow-up was never filed
`specs/follow-ups/SPEC-13.5-V12-deferred-findings.md` documents a completed research
mission on a real deal (OmniCare Review, `0d31ebf3`) that came back
`trust_grade='manual_review_required'`, `quality_score=0`, and explicitly flags: *"Either
the research pipeline is genuinely failing quality checks, or the gate is
misconfigured. Investigate before any V-12 walk."* The doc's own recommendation was to
file `SPEC-13.6` to run that investigation. **No `SPEC-13.6` file exists anywhere in
the repo** (13.5, 13.7, 13.8 exist; 13.6 does not), and no later phase doc (78, 79, 81,
82, 83, 84) references or resolves it. This has been open, unactioned, for
~2 months as of this audit.
**Fix**: re-run the Layer 3 diagnosis from scratch now — pull a fresh completed
mission's `buddy_research_quality_gates` row on a real deal and determine whether
`gate_passed=false`/`quality_score=0` outcomes are still occurring, and if so whether
it's a genuine research-quality failure or a gate-threshold/config bug (see P1-6 below
for a concrete candidate: dead thresholds in `completionGate.ts`).

### P0-6. [SILENT MEMO STUB] A second, fake "research" endpoint returns hardcoded placeholder text disguised as success
`src/app/api/deals/[dealId]/memo/research/route.ts:11-41` has no auth check and calls
`runMemoResearch()` (`src/lib/intelligence/agents/runMemoResearch.ts:8-15`), which is a
literal stub:
```ts
export async function runMemoResearch(entityName: string): Promise<ResearchResult> {
  // Placeholder for LLM + search
  return { company: "Company research pending.", industry: "Industry overview pending.", owner: "Owner background pending.", sources: [] };
}
```
The route wraps this in `{ ok: true, research: {...} }` — any caller that checks `ok`
sees success with fabricated placeholder prose, indistinguishable from "research ran
and genuinely found nothing." This is a second, disconnected "research" concept from
the real BIE pipeline, with none of BIE's guardrails, evidence coverage, or gating —
and it's silently presented as if it were real.
**Fix**: either delete this route/stub or wire it through the real
`loadResearchForMemo`/BIE path; never return `ok: true` with literal placeholder
strings from a production endpoint.

---

## P1 — Fix soon

### Mission orchestration & reliability
- **Idempotency is fully disconnected.** `orchestration.ts`'s `generateRunKey` /
  `checkExistingMission` exist specifically to prevent duplicate missions via a unique
  DB index on `(deal_id, run_key)`, but `createMission()`
  (`runMission.ts:38-73`) never sets `run_key`, and `checkExistingMission` is called
  nowhere in the live path. The only duplicate-guard that exists
  (`run.ts:104-119`) checks `status IN ('queued','running')` only — a completed mission
  never blocks a re-trigger. **Every research trigger creates a brand-new mission**,
  including a full duplicate 8-thread BIE pass if two requests race.
- **The hardened, retrying fetch layer is dead code.** `src/lib/research/fetch/fetchSource.ts`
  has retry-with-backoff, per-domain rate limiting, an allowlist/blocklist, and
  size limits — fully built, fully tested — but `ingestSource.ts` uses its own inline
  `fetchWithTimeout` (single attempt, no retry, no allowlist enforcement) and never
  calls it. One transient network blip permanently fails that source for the mission.
- **`checkpoint.ts`, `threadRuns.ts`, `failureLibrary.ts` are fully dead in
  production.** All are wired only into `brieRuntime.ts`'s `executeBrieMission`, which
  has zero production callers (only its own guard test calls it). This means: no
  resume-from-checkpoint, no per-stage failure history for operators, and critically —
  `findStaleMissions` (`checkpoint.ts:240`), the function that detects a mission stuck
  at `status="running"` forever after a process kill, is never invoked by anything. A
  mission killed mid-flight (e.g. by a platform timeout) stays "running" indefinitely
  with no sweep to recover it.
- **Mission is marked `"complete"` unconditionally**, even with zero sources, zero
  facts, and an empty narrative (`runMission.ts:329-400` — no check on
  `persistedFacts.length` etc. before the status write at line 400). If BIE also never
  ran (subject too thin), there's no `thread_diagnostics` row either — a totally empty
  mission is indistinguishable in the DB from a fully successful one except by manually
  checking counts.
- **BIE and trust-layer failures are swallowed into `console.warn` with no downstream
  record.** The entire BIE step (`runMission.ts:402-740`) and the entire trust/gate
  step (`runMission.ts:592-706`) are each wrapped in one broad try/catch. If either
  throws, the mission still shows `status="complete"` in the UI with no
  `trust_grade`/`quality_gates` row and no alert — a banker sees a "complete" research
  mission that's actually missing the differentiated analysis it's supposed to contain,
  with nothing telling them so.
- **Playbook timeboxing (`max_sources`/`max_fetch_seconds`) is entirely unenforced** —
  `ingestSources` is called with a hardcoded `{concurrency: 3, timeoutMs: 30_000}`,
  ignoring the per-mission-type budget defined in `playbook.ts`.
- **No mission-level timeout.** No `AbortController`/`Promise.race` wraps the BIE call
  or the whole mission; the only backstop is the route's `maxDuration = 300`, which —
  combined with the dead stale-mission sweep above — just kills the process and leaves
  the mission stuck.

### BIE core engine
- **6 of 8 grounded Gemini threads have no JSON-repair fallback.** Only the
  `management` thread passes a `repair` function to `callGeminiGrounded`
  (`buddyIntelligenceEngine.ts:882`) — this is documented in the code itself as the
  fix for a real production incident (OmniCare). `entity_lock`, `borrower`,
  `competitive`, `market`, `industry` have no repair path and simply drop the entire
  thread on any JSON parse failure.
- **`groundingSupports` per-sentence citation data is computed and then discarded.**
  The API returns which specific text segment each source grounded (line 264-278), but
  every call site only reads `{result, sourceUrls, diagnostic}` and discards
  `segments`. Citations shown next to any given sentence are actually the *entire
  thread's* source set, not the source that grounded that specific claim — despite this
  being advertised as key hardening feature #3 in the file's own header comment.
- **BIE research runs on the smallest model tier** (`gemini-3.1-flash-lite`, via
  `MODEL_RESEARCH`), not the Pro tier used for memo narrative prose — undercutting
  reliance on the lengthy multi-step disambiguation instructions in the prompts, since
  smaller model tiers are documented to follow multi-step instructions less reliably.
  No fallback model or retirement-detection exists — the codebase already documented
  one incident (`models.ts:33-36`) where a Gemini preview model 404'd in production and
  was silently masked by an unrelated fallback for weeks; that lesson hasn't been
  applied to `callGeminiGrounded`, which reports a model-retirement 404 identically to
  a generic transient HTTP error.
- **No `AbortController`/timeout on the raw `fetch()` to Gemini** and no
  `maxOutputTokens` set — a verbose entity (exactly the newsworthy/high-litigation
  case) that hits the model's default output ceiling produces truncated JSON that's
  reported as a generic parse error, losing the actionable signal.

### Evidence, provenance & claim ledger
- **Claim-ledger source URLs are raw, unresolved Gemini grounding-redirect proxy
  URLs** (`vertexaisearch.cloud.google.com/...`), never resolved to the actual
  publisher URL and never snapshotted — despite the codebase having fully-built,
  tested snapshot infrastructure (`sourceSnapshot.ts`, `ensureSourceArtifact.ts`,
  sha256 hashing, WORM-style artifact rows) that's wired only into the
  manually-pasted-URL flow, never into anything BIE cites. A banker-facing "source"
  citation on an adverse claim may not be independently re-verifiable months later.
- **`verification.ts` and `provenance.ts` are fully dead code in production** — both
  modules correctly implement exactly the checks this audit was asked to look for
  (checksum verification, corroboration, source-trust-weighted confidence
  propagation), are unit-tested, and have zero production call sites. They should
  either be wired into the pipeline or removed — leaving them in place creates a false
  impression on casual code review that this verification is happening.
- **Certain high-value claims are persisted with `source_uris: []` by construction** —
  `claimLedger.ts:263-296` hardcodes an empty source array for the Credit Thesis,
  Contradictions, and Underwriting Questions claims. The single most consequential
  sentence in the memo (the executive credit thesis) is never attributable to a
  checkable source.
- **`computeEvidenceCoverage`'s `supportRatio` counts claim rows, not sourced
  claims** — combined with the point above, a mission where every research thread
  fails but synthesis still runs can compute a *high* evidence-coverage ratio from
  zero-source rows. This ratio directly gates `committee_grade` at an 85% threshold,
  and **has no test file at all**.
- **Contradiction detection is mostly the LLM grading its own output.** Of 8
  structured checks in `contradictionChecklist.ts`, only 1 (`identity_mismatch`) uses
  an independently-computed signal; the other 7 fall back to regex-matching the
  synthesis thread's own self-reported "contradictions_and_uncertainties" text, or to
  coarse presence checks with no actual number comparison. The existing tests never
  exercise the regex-matching branch that runs in production.
- **Per-claim confidence is a hardcoded constant, not weighted by that claim's actual
  source trust** — two claims in the same section with wildly different source quality
  (a `.gov` filing vs. an unclassifiable blog) get identical confidence scores. The
  correct weighting formula already exists (in the dead `provenance.ts`).

### Trust gate & committee workflow
- **Adverse/litigation screening is never a hard requirement for `committee_grade`.**
  There is no adverse-screen item in the evidence-coverage item list that gates
  committee eligibility; the closest proxy (a committee blocker string) only fires when
  management is *entirely* unconfirmed — a borrower with one publicly-verifiable owner
  and clean-looking sources can reach `committee_grade` with **zero adverse-record
  search ever having run**.
- **The `preliminary` trust tier — sufficient to generate and circulate a full credit
  memo — has no real entity-identity floor.** `THRESHOLDS.preliminary.min_entity_confidence`
  is declared but never read by the grade-assignment branch
  (`completionGate.ts:504`). An entity that comes back fully `UNCONFIRMED` at 0%
  confidence can still reach `preliminary` if loan-file/self-reported fields alone
  satisfy the evidence-coverage score — because identity confirmation isn't counted in
  that score at all.
- **Self-certification alone (banker-entered business description + one fake
  principal + revenue figures) can reach memo-eligible `preliminary` grade** with no
  independent verification — `committee_grade` correctly remains unreachable this way
  (a real, tested control), but `preliminary` is enough to produce a document that
  looks authoritative to anyone who doesn't specifically check the trust-grade field.
- **The gate is a permanent one-time snapshot.** `evaluateCompletionGate` runs exactly
  once, at BIE completion. The entire downstream committee-evidence-task-resolution
  pipeline (`committeeBlockerResolution.ts` → `committeeEvidenceTasks.ts` →
  `committeeReadinessTransition.ts`) computes rich "would this resolve the blocker"
  state, but `applyCommitteeReadinessTransition` is **explicitly disabled and always
  throws** (confirmed by its own test asserting this is permanent). A banker who
  resolves every evidence task will never see the trust grade improve without a full
  BIE re-run.
- **The one governance/use-case-registry check that exists is enforced on only one of
  three execution paths** — `checkMissionGovernance` is called from the autonomous
  planner but not from `/api/research/start` or the deal research action handler, so a
  mission type marked "restricted" is blocked on one path and freely executable on
  the other two.
- **Thread coverage counts a deterministic fallback the same as a real grounded
  thread** — a management thread built entirely from the file-based deterministic
  fallback (never web-verified) counts identically toward the "4 of 6 threads
  succeeded" structural gate as a fully-grounded thread.

### API, memo integration & tests
- **A real, correctly-written test file is silently excluded from the test runner and
  has never actually executed.** `_handlers/__tests__/sourceArtifactViewer.test.ts`
  lives under a bracketed dynamic-route path (`[dealId]`/`[action]`), and
  `scripts/discover-tests.mjs` explicitly excludes any path containing `(` or `[` —
  confirmed directly: running it in place produces `0 tests` silently, no error at all.
- **The golden-set eval harness is not wired into CI at all**, and its documented
  invocation command fails on a clean install (`Cannot find module 'server-only'`,
  missing devDependency). Once forced to run: only 6 of 20 cases (30%) produce a real
  pass/fail signal — 14 are permanently unpopulated `POPULATE_FROM_PROD` placeholders,
  and the one case explicitly marked **"Mandatory regression — must never recur"**
  (`yacht-charter-regression`) is silently auto-skipped by the harness's own
  placeholder-detection logic because it deliberately sets `company_name: null` to
  simulate the no-borrower-info case that placeholder-detection also matches on.
- **Good news, stated plainly:** `tsc --noEmit` is fully clean (0 errors) across the
  whole project. All 537 pure-logic research unit tests pass (0 fail, 0 skipped). The
  latest-mission-selection logic that feeds the memo is correct everywhere it matters —
  there is no path where a stale/superseded mission's narrative could reach a memo. The
  "Layer 3" memo-render hallucination guard mentioned in a `runMission.ts` comment is
  genuinely implemented (`loadResearchForMemo.ts:323-380`), not a dangling TODO — it
  independently re-validates Management Intelligence against live `ownership_entities`
  data at render time, separate from the mission-storage-time guard.

---

## Known-issues cross-check (what the team already knew)

A mining pass over `specs/`, `docs/archive/`, and root-level phase docs confirms the
research system has already been through multiple real hardening cycles (Phases
78/79/81/82/83), most of which verifiably shipped (entity lock, per-section citations,
NAICS-999999 guard, per-sentence narrative storage, trust-enforcement gating on memo
generation). Two load-bearing patterns recur across that history and match this
audit's findings almost exactly:

1. **"Empty inputs masquerading as validation failures"** — at least twice, a gate
   correctly implemented its logic but read from the wrong/stale table, and got
   misdiagnosed as an AI-quality problem rather than a plumbing bug. Worth keeping in
   mind before assuming any future gate-scoring anomaly is a "research quality" issue —
   check the reader first.
2. **"Non-fatal by design" swallowing real failures** — this is a deliberate,
   documented resilience choice (any thread failing returns null, mission continues)
   that has already caused at least one multi-week silent-data-loss incident in a
   sibling system (`stampDocument`, per `phase-84-audit-remediation.md`) via the same
   `.update()`-without-error-check pattern. This audit found the identical pattern
   independently in `runMission.ts` (P1 findings above) and in
   `sourceConnectors/persistSnapshot.ts:132-134`, which swallows an artifact-capture
   failure with **not even a `console.warn`**.

The one item that should be treated as urgent precisely because the team already
flagged it and then lost track of it is **P0-5** above (SPEC-13.6).

---

## God-tier roadmap

Ordered by leverage — cheapest fixes with the biggest reliability jump first.

### Phase 1 — Wire up what's already built (highest leverage, lowest new-code cost)
Every item below is a case of fully-built, unit-tested code that simply isn't called
from the live path. This is the single best ROI in the whole audit — it's connecting
work, not doing new design.
1. Route `ingestSource.ts` through the already-hardened `fetchSource.ts` (retry,
   backoff, allowlist, rate limiting) instead of its bare inline fetch.
2. Set `run_key` on mission creation and call `checkExistingMission` before creating a
   new mission, closing the idempotency gap end to end.
3. Either make `runMission.ts` the function `brieRuntime.ts`'s checkpoint/retry/
   heartbeat/stale-mission-sweep system expects, or delete that ~700 lines of dead
   infrastructure so the codebase doesn't overstate its own resilience.
4. Cron `findStaleMissions` (already written) into the existing worker-tick sweep so a
   process-killed mission gets flipped to `failed` instead of stuck at `running`
   forever.
5. Wire `verification.ts`/`provenance.ts` into the real claim ledger, or remove them.
6. Snapshot every BIE-cited URL through the existing `fetchUrlSnapshot` +
   `ensureSourceArtifactForSnapshot` pipeline, resolving Gemini's redirect URIs to
   real, hashed, immutable evidence artifacts.

### Phase 2 — Close the trust/safety gaps that let bad output through undetected
7. Extend the Management-Intelligence hallucination scrub to Borrower
   Profile/Litigation-and-Risk (P0-3).
8. Fix `classifyEntity`'s confidence-gated mismatch check (P0-4).
9. Add adverse/litigation screening as a hard `committee_eligible` requirement, not a
   side-effect of management confirmation status.
10. Reinstate a real entity-confidence floor for the `preliminary` grade so a fully
    unidentified entity cannot become memo-eligible.
11. Give the trust/completion-gate layer an unconditional degraded-state write
    (mirroring what `thread_diagnostics` already does), so a BIE crash or gate-write
    failure is never indistinguishable from a genuine pass.
12. Enforce the governance use-case registry on every mission-trigger path, not just
    the autonomous planner.

### Phase 3 — Make the system genuinely audit-proof
13. Move per-thread `groundingSupports` segments through to the claim ledger so
    citations are claim-level, not thread-level.
14. Extend JSON `responseMimeType`/repair to all 6 grounded threads, not just
    management.
15. Model pinning + an explicit fallback model + a distinct "likely model retirement"
    diagnostic, closing a gap the team has already been burned by once.
16. Replace self-graded contradiction detection with real cross-thread numeric diffing
    (revenue, DSCR) for the checks that are checkable, instead of regex-matching the
    LLM's own summary text.
17. A real gate re-evaluation trigger when committee evidence tasks are resolved,
    instead of a permanently-disabled `applyCommitteeReadinessTransition`.
18. A periodic re-verification / expiry policy for deals sitting at `preliminary` (i.e.
    self-certified, unconfirmed-identity) grade for an extended period.

### Phase 4 — Operational maturity
19. Route BIE/trust-layer exceptions to real alerting (paging/monitoring), not
    `console.warn` in serverless stdout that scrolls away.
20. Rate-limit and properly tenant-isolate every research API route (P0-1, P0-2 — these
    are urgent enough to also be Phase 0, listed here for completeness of the
    roadmap).
21. Fix the test-discovery bracket-path exclusion so bracketed-route test files
    actually run, and wire the golden-set eval into CI as a real merge gate — including
    fixing the `yacht-charter-regression` case's accidental self-exclusion and setting
    a deadline/CI-fail condition on the 14 permanently-placeholder cases.
22. Re-run the SPEC-13.6 investigation now (P0-5) and either close it with a documented
    root cause or file the real spec this time.

---

## Appendix — severity legend used above
- **Critical**: could produce cross-tenant data exposure, a false borrower-damaging
  claim in a live memo, or an entity-misidentified deal reaching a trusted grade.
- **High**: a real reliability/trust-integrity gap, contained today by at most one
  secondary control, with no test coverage of the failure mode.
- **Medium/Low**: real but narrower-blast-radius defects, or items explicitly
  documented as deliberate scope-narrowing that should be revisited.
