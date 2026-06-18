# Smoke AAR — SPEC-LAUNCH-SMOKE-BORROWER-SPREAD-EVIDENCE-1

**Date:** 2026-06-18
**Branch:** `main` @ `fcea2960` (#538 hardening) on top of `e4cbf81b` (#537 loop). `git pull` → already up to date.
**Nature:** code-level launch smoke. This environment has **no running deployment, DB, or browser**, so
the manual portal/DB/click steps were executed as **contract verification** via the loop's unit-test
coverage + targeted code inspection — not a live browser session. Called out per-smoke below.

## Preflight gates (commands run)

| Command | Result |
|---|---|
| `git checkout main` / `git pull origin main` | clean, already up to date |
| `npm run test:unit` | **PASS** — 8572 pass, 0 fail, 1 pre-existing skip (8573 total) |
| `npm run build` | **PASS** — exit 0 (known dependency/static-analysis warnings only) |
| `npm run check:routes` | **PASS** — exit 0, 908 route files < 925 fail threshold |

Targeted contract suite (8 files exercising the loop): **98 pass / 0 fail.**

## Smoke results

| # | Smoke | Verdict | Evidence |
|---|---|---|---|
| 1 | Borrower portal baseline (ordinary upload unaffected) | **PASS** | `commit/route.ts` writes spread metadata only under `hasSpreadLinkage`; ordinary uploads add nothing. Session route builds checklist tasks independently of spread tiles (own try/catch → `[]` on failure). `borrowerPortalSpreadRequestTilesWiring.test.ts`, `sourceEvidenceWiring.test.ts` ("same portal upload route files"). |
| 2 | Active spread request tile renders w/ borrower-safe copy | **PASS** | `borrowerPortalSpreadRequestTiles.test.ts` — active action ⇒ tile w/ evidence kind / period / clearing target; asserts `banker_internal_note` never surfaced and description has no "internal". |
| 3 | Closed/malformed requests don't render broken tiles | **PASS** | Tile tests (closed/source_verified/no-action ⇒ no tile) + `borrowerSpreadEvidenceLaunchHardening.test.ts` (no action id **and** no finding key ⇒ no tile; empty-string linkage ⇒ no tile). Builder is pure; session route non-fatal ⇒ no crash on malformed metadata. |
| 4 | Spread tile upload persists **normalized** linkage | **PASS** | `commit/route.ts` `linkStr()` trims, empty/whitespace → null; metadata written only when ≥1 tie-back present. `sourceEvidenceWiring.test.ts` ("commit accepts + persists spread linkage") + hardening test ("empty-string metadata ⇒ candidate, not linked"). Empty strings never stored. |
| 5 | Banker panel labels human-readable | **PASS** | `UPLOAD_LABEL` now covers **7/7** `EvidenceUploadStatus` members (incl. `linked_evidence_uploaded`, `unknown`); `REQUEST_LABEL` covers all request states; clearing rendered via human ternaries. No `label ?? rawToken` leak path remains. |
| 6 | Upload/extraction does **not** clear | **PASS** | `sourceEvidenceStatus.test.ts` + `linkedEvidenceCloseLoop.test.ts`: linked-not-extracted ⇒ `still_blocking`; linked exact extracted ⇒ `needs_regenerate` (not cleared); only a settled/pruned action ⇒ `cleared_after_regenerate`. |
| 7 | Regenerate closes only after audit absence | **PASS** | `reviewActionsPrune.test.ts` + `linkedEvidenceCloseLoop.test.ts` ("cleared only after audit absence"): `syncReviewActions` closes stale rows scoped `.in("status", ACTIVE_REVIEW_ACTION_STATUSES)` only ⇒ banker-settled rows never system-pruned; tile disappears once action inactive. |
| 8 | Negative cases stay honest | **PASS** | Hardening + status tests: candidate-only never fulfills; wrong-period linked ⇒ bridge-required/blocking; 2022 1120/Schedule-L is a candidate (not linked) and does not clear YTD-2026 TCA. |
| 9 | Certification / PDF no regression | **PASS** | `certificationSummary.openReviewActionCount` is fed from live review rows (closed ≠ active ⇒ not counted); certification + PDF-render suites pass within `test:unit`; `npm run build` (PDF render path) exits 0. |

## Blockers found

**None.** All launch contracts hold:
- request creation / upload / extraction never clear a blocker;
- only regenerate + latest-audit absence closes/prunes the active action;
- closed/inactive/malformed actions never render as active borrower tiles;
- banker-settled rows are never system-pruned;
- ordinary checklist uploads are unaffected by spread linkage.

## Patches made

**None required.** No concrete launch blocker surfaced; per the decision rule, no schema/route/math/
source-line/reconcile/canonical-VM/BBC changes and no feature work were introduced. No new tests added
(the discovered-blocker test rule did not trigger — nothing was discovered to patch).

## Environment limitation (disclosed)

The literal live steps — opening a real borrower portal link in a browser, uploading through Supabase
storage, and inspecting persisted `deal_documents.metadata` rows, then clicking Regenerate against a live
deploy — were **not** run; no running app/DB/browser is available in this smoke environment. Each such
step was verified at the code-contract level by the corresponding unit tests and direct inspection of the
exact code paths the live action would hit. A pre-launch human pass on a live deploy is still recommended
for Smokes 1–4 and 7 to confirm the runtime/storage wiring end-to-end.

## Launch recommendation

**GO (launch-ready) at the code/contract level.** Smokes 1–7 pass; 8 and 9 pass. Gates green
(test:unit 8572/0, build 0, check:routes 908<925). Recommend one live-deploy confirmation pass of the
portal upload + regenerate round-trip before flipping the launch flag, since those touch runtime storage
and the audit/regenerate worker that unit tests stub.
