# Credit Memo Legacy Decommission Inventory

Generated: 2026-05-22

## System Classification

| System / Table | Classification | Current Readers | Current Writers | Canonical Replacement | Safe Action | Risk |
|---|---|---|---|---|---|---|
| `deal_memo_overrides` | legacy-read-only | buildCanonicalCreditMemo (fallback), buildMemoInputPackage (prefill), BankerReviewPanel (UI-state) | /memo-overrides PATCH, BankerReviewPanel (UI-state only) | deal_borrower_story, deal_management_profiles, deal_collateral_items | stop writing narrative fields; keep for UI-state only | Medium |
| `principal_bio_*` override keys | legacy-write-disabled | buildCanonicalCreditMemo (fallback after profiles) | memo-inputs from-wizard (migrates to deal_management_profiles) | deal_management_profiles | stop reading as primary; fallback only | Low |
| `collateral_description` override | legacy-read-only | buildCanonicalCreditMemo (fallback when no AR) | MemoQualitativeForm (via memo-overrides) | AR borrowing base narrative, deal_collateral_items | ignore for AR LOC deals | Low |
| `canonical_memo_narratives` | canonical | canonical/page.tsx, print/page.tsx, PDF routes, narrative assembly | narrative generation routes | Same (with input_hash gate) | enforce input_hash matching on all read paths | High |
| `CLASSIC_PDF` spread type | delete-candidate | lifecycle advanceDealLifecycle, spreadsProcessor | classicPdfWorker | Canonical memo print/PDF via CanonicalMemoTemplate | filter from committee-facing lists | Low |
| `STANDARD` spread type | delete-candidate | orchestrateSpreads, renderStandardSpread | spread orchestrator | Standard spread route (/spreads/standard) | filter from committee-facing lists | Low |
| `GLOBAL_CASH_FLOW` placeholder rows | legacy-read-only | SpreadsAppendix | spread orchestrator (queues placeholder) | Canonical GCF from financial facts | filter placeholders from appendix | Low |
| `ownership_entities` as bio source | migrated | buildCanonicalCreditMemo (ownership/guarantor identity only) | ownership engine | deal_management_profiles for bios | keep for ownership structure; bios from profiles | Low |
| `deal_memo_overrides` narrative fields | legacy-write-disabled | buildCanonicalCreditMemo (last fallback) | MemoQualitativeForm | deal_borrower_story | quarantine; add legacy-fallback helper | Medium |
| Print route narrative overlay | legacy-read-only | canonical/print/page.tsx | N/A | input_hash gated overlay (same as canonical page) | add input_hash gate | High |
| `/api/deals/[dealId]/memo-overrides` | legacy-write-disabled | BankerReviewPanel GET | PATCH (validates keys) | /api/deals/[dealId]/memo-inputs | deprecate PATCH for narrative fields | Medium |
| `/api/deals/[dealId]/credit-memo/overrides` | deprecated | GET compatibility shim | POST is no-op | /api/deals/[dealId]/memo-inputs | already deprecated; monitor usage | Low |
| `MemoQualitativeForm` | legacy-read-only | BankerReviewPanel | Writes via onChange callback | Canonical memo-inputs form | route canonical fields to memo-inputs | Medium |
| `MemoDataEntryCard` | canonical | canonical/page.tsx | Routes to financial facts | N/A (already canonical) | keep | None |
| `BankerReviewPanel` | canonical | canonical/page.tsx | Dual-write: canonical + UI-state | N/A (already routes correctly via SPEC-13.5) | keep; verify no narrative writes to overrides | Low |
| `buildMemoInputPackage` | canonical | memo-inputs page, credit-memo page | N/A (assembler) | N/A (already canonical) | keep; triggers legacy migration | None |
| Old memo template (`MemoTemplate.tsx`) | delete-candidate | memo-template page | N/A | CanonicalMemoTemplate | redirect or remove route | Low |

## Narrative Overlay Read Paths

| File | Has input_hash gate? | Action Required |
|---|---|---|
| `src/app/(app)/credit-memo/[dealId]/canonical/page.tsx` | YES (added in activation sprint) | None |
| `src/app/(app)/credit-memo/[dealId]/canonical/print/page.tsx` | NO — blindly overlays | Add input_hash gate |
| `src/app/api/deals/[dealId]/credit-memo/canonical/pdf/route.ts` | N/A — reads from certified snapshot | None |
| `src/app/api/deals/[dealId]/committee/packet/generate/route.ts` | Reads narratives for packet | Verify hash check |

## Write Path Audit

| Component / Route | Writes To | Canonical? | Action |
|---|---|---|---|
| BankerReviewPanel → from-wizard | deal_borrower_story, deal_management_profiles | YES | Keep |
| BankerReviewPanel → UI-state | deal_memo_overrides (tabs_viewed, committee_ready) | OK (non-narrative) | Keep |
| MemoQualitativeForm → onChange | deal_memo_overrides (narrative fields) | NO — legacy | Route to memo-inputs |
| /memo-overrides PATCH | deal_memo_overrides | NO — legacy | Add deprecation warning for narrative keys |
| /memo-inputs PUT | deal_borrower_story | YES | Keep |
| /memo-inputs POST management | deal_management_profiles | YES | Keep |
| /memo-inputs POST collateral | deal_collateral_items | YES | Keep |
