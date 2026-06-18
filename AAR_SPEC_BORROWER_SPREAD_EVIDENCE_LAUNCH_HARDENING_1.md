# AAR — SPEC-BORROWER-SPREAD-EVIDENCE-LAUNCH-HARDENING-1

**Branch:** `spec/omnicare-spread-evidence-demo-path` (off `main` @ e4cbf81b, post-#537)
**Status:** staged working tree — not committed, no PR (per spec deliverable)
**Scope:** harden the merged borrower spread evidence loop (#537) for launch — failure-state safety,
borrower/banker clarity, and debug observability. No new product surface.

## Objective recap

#537 shipped the end-to-end loop (banker requests borrower evidence on a spread review action →
borrower portal upload tile → upload carries linkage → metadata round-trips to LINKED evidence →
regenerate + audit-absence closes the action). This spec made it launch-ready by closing defensive
gaps, **without** touching financial math, source-line resolvers, `reconcileFinancialFacts`, the
canonical VM, or BBC. No schema/migration, no new route.

## Audit result

The merged flow already degrades honestly for most failure states (missing ids → no tile / candidate
classification; upload-before-extraction → `linked_evidence_uploaded` + still blocking; wrong-period →
`candidate_uploaded_needs_bridge` + still blocking; settled-only clears; prune closes only ACTIVE rows,
never banker-settled). Three concrete launch-risk gaps were found and fixed; the rest were verified and
pinned with tests.

## Changes

1. **Banker panel — complete status labels.**
   `src/components/deals/spreads/SpreadReviewActionsPanel.tsx` — `UPLOAD_LABEL` was missing
   `linked_evidence_uploaded` and `unknown`, so the central "linked evidence received / awaiting
   extraction" state (and the enrichment-unavailable state) rendered a raw machine token to the banker.
   Added human labels. Satisfies spec §5 ("clearly distinguish … linked evidence received / awaiting
   extraction").

2. **Portal tile — never blank, never broken.**
   `src/lib/classicSpread/review/borrowerPortalSpreadRequestTiles.ts`:
   - Added an explicit forwardable-linkage guard: a spread draft that carries the source token but has
     **neither** `source_review_action_id` **nor** `source_finding_key` can never produce an upload
     that becomes LINKED evidence, so it no longer renders a tile (was previously skipped implicitly via
     the action lookup; now an explicit, commented guard so a future refactor can't regress it).
     Satisfies §3 ("do not render broken upload tiles without enough linkage to fulfill").
   - Added `safeBorrowerInstruction()`: when `draft_message` is empty/whitespace (legacy/partial draft),
     synthesize a conservative borrower-safe instruction from the structured fields
     (clearing target → acceptable docs → evidence kind + period). A borrower never sees a bare Upload
     button. Banker-internal copy is never referenced. Satisfies §3 ("clear borrower-safe instructions").

3. **Upload commit — clean linkage + debuggable receipt.**
   `src/app/api/portal/upload/commit/route.ts`:
   - Normalize the four linkage fields with `linkStr()` (trim; empty/whitespace → null) so empty-string
     values never pollute `deal_documents.metadata`. Additive only — ordinary uploads (no linkage) are
     completely unaffected. Satisfies §4 ("accept linkage metadata only as additive metadata").
   - Unified the metadata-write gate and the `spread_evidence_uploaded` debug-event gate to a single
     `hasSpreadLinkage` (review-action id **or** finding key **or** draft id). Previously a *draft-only*
     linked upload wrote linkage metadata but emitted **no** debug event — invisible in production. The
     event now fires for any tie-back and records which linkage keys were present
     (`payload.linkage.{has_review_action_id,has_finding_key,has_draft_request_id}`), so a "why didn't my
     upload link?" question is answerable from the event alone. Still status-only; never clears a blocker.
     Satisfies §4 + acceptance ("useful debug metadata/event information exists for linked upload receipt").

## Tests

New: `src/lib/classicSpread/review/__tests__/borrowerSpreadEvidenceLaunchHardening.test.ts` (10 tests,
high-value over broad):
- tile never blank (fallback from clearing target; fallback from evidence kind + period);
- malformed draft (no action id + no finding key) → no tile; empty-string linkage → no tile;
- linker: empty-string metadata and draft-id-only-with-no-draft-record both degrade to **candidate**,
  never LINKED (never fulfilling);
- regenerate NOT recommended for: linked-not-extracted, linked-wrong-period-no-bridge, context-only
  candidate, documents-unavailable.

Full suite: **8572 pass / 0 fail / 1 skipped** (pre-existing skip). `check:routes` 908 (unchanged, no new
route). `npm run build` compiles (pre-existing warnings only).

## Acceptance criteria — verification

| Criterion | Status |
|---|---|
| Existing checklist uploads work when spread request loading fails | ✅ session route already try/catches spread tiles independently; checklist tasks built before & unaffected |
| Broken/partial spread metadata never crashes the portal | ✅ pure builder guards; session route non-fatal |
| Broken/partial spread metadata never clears a blocker | ✅ clearing is audit-only; linkage degrades to candidate |
| Candidate-only & wrong-period uploads remain blocking w/ clear explanation | ✅ existing model + new negative tests |
| Linked-not-extracted remains blocking/waiting | ✅ `linked_evidence_uploaded` + still_blocking + label fix |
| Linked extracted exact/bridge → regenerate needed, not cleared | ✅ unchanged model (pinned by existing tests) |
| Regenerate CTA not shown for candidate-only / wrong-period / not-extracted | ✅ new negative tests (see limitation note) |
| Closed/settled/system-pruned actions don't render as active tiles | ✅ existing + tile tests |
| Banker-settled actions never system-pruned | ✅ prune scopes `.in("status", ACTIVE_REVIEW_ACTION_STATUSES)` only |
| Useful debug metadata/event for linked upload receipt | ✅ event now fires for any linkage + records key presence |
| No schema/migration, no new route, no financial-math / resolver / reconcile / VM / BBC change | ✅ |
| `test:unit`, `build`, `check:routes` pass | ✅ |

## Scope deviations / decisions (flagged per repo convention)

- **Regenerate CTA for exact-extracted *heuristic* candidates is intentionally preserved.** The merged
  model (and an existing, passing test, `sourceEvidenceStatus.test.ts` "exact-period AR aging uploaded +
  extracted → needs_regenerate") treats an exact-period, extracted, *augmenting* candidate as
  regenerate-worthy even without explicit borrower linkage, because that document genuinely provides the
  missing detail the audit would consume. I read the acceptance phrase "candidate-only … CTA not shown"
  as referring to candidates that are **wrong-period, not-yet-extracted, or context-only** (the
  already-consumed base statement) — all of which correctly stay `still_blocking` with no CTA, now pinned
  by new negative tests. I deliberately did **not** restrict the CTA to linked-only, as that would be a
  behavior change to the established clearing model (out of scope: "keep launch risk low", "no financial
  math changes") and would regress a merged test. Flagging explicitly rather than silently changing it.

## Known limitations (carried, not introduced)

- **Clearing remains audit-driven only.** A linked, extracted, correct-period upload still requires a
  banker-triggered regenerate + a fresh audit that drops the finding before the action closes. There is
  no auto-regenerate on upload (by design — no silent clearing). The borrower portal has no regenerate
  control; the banker drives it from the Review Actions panel.
- **Period inference is heuristic** (`ai_period_end` → tax year → filename parse). A borrower upload
  whose period can't be parsed reads `periodMatch: "unknown"` and stays blocking until a banker reviews —
  conservative, but may require manual confirmation for oddly-named files.
- **Tile fallback copy is generic** when a draft carries no structured fields at all; it instructs the
  borrower to provide "supporting documentation" with the period if known. Better than blank, but a
  fully-populated request (the normal path via `buildSourceDetailRequest`) is far more specific.
- **Cross-deal linkage spoofing is inert, not rejected.** A borrower POSTing another deal's action id
  cannot cause a false link (the linker only matches actions within the upload's own deal, and clearing
  is audit-only), so a spoof degrades to a candidate. No explicit rejection was added — not needed for
  safety, but noted.
