# AAR — SPEC-BORROWER-PORTAL-SPREAD-REQUEST-TILES-1

## Objective
Render classic-spread source-detail requests (`draft_borrower_requests`) as borrower-portal upload
tiles, using the structured request package / `uploadContext` already produced by
SPEC-BORROWER-EVIDENCE-REQUEST-PACKAGE-POLISH-1, so a borrower can answer a spread blocker directly
and the upload becomes LINKED evidence for the exact review action.

## What shipped

### New — pure projection
- `src/lib/classicSpread/review/borrowerPortalSpreadRequestTiles.ts`
  - `buildBorrowerSpreadRequestTiles({ drafts, actions })` → `BorrowerSpreadRequestTile[]`.
  - Reads ONLY the draft's `evidence` jsonb (the structured package: `requested_evidence_kind`,
    `requested_period`/`requested_period_end`, `clearing_target`, `statement_type`, `line_item`,
    `acceptable_documents`, `unacceptable_documents`, `source_finding_key`,
    `source_review_action_id`) + `draft_subject`/`draft_message`. Banker-internal copy
    (`banker_internal_note`) is never surfaced.
  - **Honest lifecycle gate:** a tile renders only when (a) the draft is a spread source-detail
    draft (`evidence[].source === "classic_spread_source_detail"`), (b) the draft status is active
    (`pending_approval|approved|sent`), and (c) a matching `classic_spread_review_actions` row is
    still ACTIVE via `isActiveReviewActionStatus` (`open` / `borrower_detail_requested`). The review
    action is the authority — a closed / settled / system-pruned action ⇒ no tile.
  - Matches the action by review-action id first, then `finding_key` (stable across re-sync).
  - `hasUploadContext` flags whether structured context is present (exact linked evidence) vs a
    bare informational/fallback request; linkage is still forwarded either way.

### Wiring (existing route, existing tables — no new route/table/migration)
- `src/app/api/portal/session/route.ts` — loads `draft_borrower_requests` +
  bank-scoped `classic_spread_review_actions`, projects via the pure builder, returns
  `spreadRequests`. Wrapped in try/catch (non-fatal; never breaks the portal session).
- `src/app/portal/[token]/ui.tsx` — new "Additional evidence requested" section renders each tile
  (title, plain-English instruction, evidence-kind + period chips, clearing target, "What counts"
  disclosure). The tile Upload calls the existing `doUpload(null, file, null, spreadLinkage)`,
  forwarding `spreadReviewActionId` / `spreadFindingKey` / `draftBorrowerRequestId` /
  `requestedEvidenceKind`. Existing checklist tiles and the "Upload additional info" path are
  unchanged.

The commit route (`/api/portal/upload/commit`) and `attachSourceEvidence` /
`evidenceUploadLinker` already persist the linkage into `deal_documents.metadata` and classify the
upload as LINKED evidence (from SPEC-BORROWER-EVIDENCE-UPLOAD-TO-BLOCKER-CLEARING-1) — no change
needed; this spec just feeds them the linkage from the borrower surface.

### Tests
- `__tests__/borrowerPortalSpreadRequestTiles.test.ts` — pure (OmniCare-shaped): YTD 2026 Total
  Current Assets request → `current_asset_detail` tile with structured copy + exact linkage; an
  upload carrying that linkage classifies `explicit` LINKED via `linkEvidenceUploads`; closed /
  settled / no-matching-action / inactive-draft ⇒ no tile; finding_key fallback; unrelated draft
  ignored; missing-uploadContext fallback still forwards linkage; 2022 Schedule L tile gated on its
  own action.
- `__tests__/borrowerPortalSpreadRequestTilesWiring.test.ts` — session route loads existing tables
  (bank-scoped) + returns `spreadRequests` non-fatally; UI renders the labeled section and forwards
  the four linkage fields; existing checklist tile call unchanged; one session route file only.

## Honest-lifecycle invariants preserved
- Rendering a tile does not clear; upload does not clear; extraction does not clear. Closure happens
  only after regenerate + audit-absence prune closes the review-action row — at which point the tile
  stops rendering because the action is no longer active. No auto-clear on render/upload/extraction.

## Acceptance — verified
- ✅ Unresolved spread requests appear as borrower upload targets.
- ✅ Upload forwards exact linkage; commit persists it into `deal_documents.metadata`;
  `evidenceUploadLinker` classifies it LINKED (proven end-to-end in the pure test).
- ✅ Completed/closed/settled actions do not appear as active upload requests.
- ✅ Existing checklist tiles unchanged. Candidate behavior for unrelated uploads preserved.
- ✅ No schema/migration. No new route (`check:routes` = 908, unchanged). No
  math/source-line/reconcile/canonical-VM/BBC change.
- ✅ `test:unit` 8562 pass / 0 fail (1 pre-existing skip). `build` green.

## Exceptions / scope notes
- None. A tile requires a matching ACTIVE review action; if the action query fails or returns
  nothing, the session falls back to zero tiles (fail-closed) rather than risk showing a stale
  request — consistent with the "honest, never auto-clear" guardrail.
