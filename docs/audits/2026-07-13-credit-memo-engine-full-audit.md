# Credit Memo Engine — Full Audit

Generated: 2026-07-13

## Purpose

Full-engine audit of the credit memo pipeline (builders, financial calculations,
committee gating, submission/certification lifecycle, API routes, inputs/narrative/UI).
Six parallel reviews covering ~19,000 lines across `src/lib/creditMemo/`,
`src/app/api/deals/[dealId]/credit-memo/**`, `src/components/creditMemo/**`, and the
related Supabase migrations. This audit only reports concrete defects with a specific
failure scenario — no style/refactor suggestions.

Two cross-cutting patterns showed up independently in multiple subsystems and should be
treated as the top priority, not just the individual findings under them:

1. **Missing tenant/bank ownership checks ("IDOR").** Several read/write paths trust
   `dealId`/`memoId` from the URL or request body without confirming the caller's bank
   owns that deal. Because `supabaseAdmin()` uses the service-role key, RLS provides no
   backstop once a route skips the application-level check.
2. **Fail-open error handling.** Several places catch a DB/query error and substitute
   `null`/a default, which downstream code then treats as "no problem" rather than
   "unknown" — silently converting an outage or a data gap into a clean bill of health.

---

## CRITICAL

### C1. Cross-tenant IDOR — citations & geometry routes have no auth at all
`src/app/api/deals/[dealId]/credit-memo/[memoId]/citations/route.ts`,
`src/app/api/deals/[dealId]/credit-memo/[memoId]/geometry/route.ts`

Neither file imports any auth helper (no `clerkAuth`, no `ensureDealBankAccess`). Both
query Supabase filtered only by `.eq("deal_id", dealId)` — that constrains which *rows*
come back, but never checks that the *caller* is entitled to that `dealId`. There is no
`middleware.ts` backstopping this repo-wide. Any unauthenticated or cross-bank user who
has (or guesses/leaks) a `dealId`/`memoId` can read another bank's memo citation text and
OCR bounding-box geometry for private financial documents. `geometry/route.ts` compounds
this by triggering a real Azure Document Intelligence OCR call for uncached attachments —
an unauthenticated, unthrottled cost/DoS vector layered on top of the data leak.

### C2. Cross-tenant IDOR — `/api/deals/[dealId]/credit-memo/generate`
`src/app/api/deals/[dealId]/credit-memo/generate/route.ts:42-79,148-153`

Resolves `bankId` via `getCurrentBankId()` (the *caller's own* bank) but never verifies
`dealId` belongs to that bank — unlike the sibling `submit` and `underwriter-decision`
routes, it doesn't call `requireDealAccess`/`ensureDealBankAccess`. Every downstream query
(`deals`, `deal_financial_facts`, `ai_risk_runs`, `buddy_research_missions`) filters only
by `.eq("id", dealId)`. `loadFinengineMemo` has the same gap. Any authenticated user at
Bank B can `POST` a Bank A `dealId` and receive that borrower's full financials/narrative,
while also writing a `canonical_memo_narratives` row keyed to Bank A's deal under Bank B's
`bank_id` — both a data leak and a data-integrity corruption.

### C3. Cross-tenant IDOR — `/api/ai/credit-memo`
`src/app/api/ai/credit-memo/route.ts:9-22` → `src/lib/deal/buildDealContext.ts:41`

`withApiGuard({ requireAuth: true })` only checks the caller is *some* authenticated
user — it never checks deal ownership, and neither does `buildDealContext` or the
functions it calls (`getDealRecord`/`listDocuments`/`listExtracts`). Any logged-in user
at Bank A can POST `{ dealId: "<Bank B's deal>" }` and get Bank B's deal context plus an
AI-generated credit memo back in the response.

### C4. Missing `bank_id` filter throughout `buildCanonicalCreditMemo`
`src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts` (~282-336, ~1010-1016, ~1410-1451)

Reads of `ownership_entities`, `ai_risk_runs`, `deal_structural_pricing`, period facts,
qualitative facts, personal-income facts, `deal_borrower_story`, `buddy_covenant_packages`,
and OD-normalization facts filter by `deal_id` only — every sibling reader elsewhere in the
codebase (`buildBindings.ts`, `factsAdapter.ts`, `getCanonicalMemoStatusForDeals.ts`) filters
by both `deal_id` and `bank_id`. `deal_financial_facts` has a confirmed composite unique
index on `(deal_id, bank_id, fact_identity_hash)`, meaning the same `deal_id` legitimately
carries rows under multiple banks for shared/participated deals — this is the same bug
class already found once and fixed for `deal_collateral_items` (see
`specs/follow-ups/SPEC-FOUNDATION-V1-PR2-deal-collateral-items-tenant-scoping-design.md`).
On a participated deal, Bank A's committee memo can render qualitative/management data or
a borrower story written under Bank B's session.

### C5. Committee policy-exception gate queries the wrong table and always no-ops
`src/lib/creditMemo/committee/buildCommitteeAnticipation.ts:128`,
`src/lib/creditMemo/inputs/buildMemoInputPackage.ts:513`

Both query a table named `policy_exceptions`; the real table (per
`supabase/migrations/20260505_committee_exception_workflow.sql`) is
`deal_policy_exceptions`. The queries always fail and are silently caught to defaults
(`0` open exceptions / `true` = "reviewed"). The hard `policy_open_exceptions` objection
and the `missing_policy_exception_review` blocker **can never fire**, no matter how many
open policy exceptions exist on a deal. A deal with outstanding LTV/equity exceptions can
show as `committee_ready`.

### C6. Committee gate fails open when intelligence fails to load
`src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts:1471` (swallows
`loadMemoCommitteeIntelligence` errors to `null`) → `applyCommitteeGate.ts:14`
(`applyCommitteeGateToRecommendation`/`committeeGateConditions` treat a `null` section
as "ready" with no caveats/conditions).

A transient DB/RLS failure while loading committee readiness renders a clean,
un-caveated recommendation for a deal that may have failed research entirely. Compounding
finding: `isCommitteeEligible` in the same file *does* have a fallback guard for a null
section, but the caveat/conditions functions don't — so `certification.isCommitteeEligible`
can say `false` while the narrative text shows no caveat, the exact inconsistency the
module's own docstring says it prevents.

### C7. Ratio table silently relabels genuine policy failures as "N/A"
`src/lib/creditMemo/canonical/buildRatioAnalysisSuite.ts:~1005-1009`

```js
} else if (interp.assessment === "Weak" && benchmarkable) {
  finalAssessment = "N/A";
  finalBenchmarkNote = "Unbenchmarked — ... Assessment deferred.";
}
```
This applies to DSCR, Debt/EBITDA, Interest Coverage, Current/Quick Ratio, Debt/Equity —
all scored against fixed policy floors independent of any peer benchmark. A DSCR of
1.10x (fails the 1.25x floor) on a deal with no matched NAICS/revenue-tier benchmark
renders as `N/A — Assessment deferred` in the committee-facing table instead of `Weak`,
hiding a real repayment-capacity failure.

### C8. Missing financial data scored identically to genuinely weak data
`src/lib/creditMemo/riskRating/buildConventionalRiskRating.ts:~180-190`

```js
if (grossMarginPct !== null && grossMarginPct >= 0.30) { qualScore += 8; }
else if (grossMarginPct !== null && grossMarginPct >= 0.15) { qualScore += 4; ... }
else { qualScore += 1; drivers.push({..., detail: "Thin gross margin ..." }); }
```
A deal with **no margin data at all** falls into the same branch as a deal with a
genuinely critical thin margin, and a false "Thin gross margin" driver is generated. This
qualitative score feeds the composite score that sets the 1–8 risk grade (thresholds at
85/75/65/55/45/35/20) — a data gap, not a real weakness, can flip the grade across a
boundary.

---

## HIGH

### H1. Underwriter-decision route has no role check (self-approval)
`src/app/api/deals/[dealId]/credit-memo/underwriter-decision/route.ts:44`

Calls `requireDealAccess(dealId)`, which enforces same-bank + non-borrower but never
checks the caller's role is `underwriter` (contrast with `requireApiRole` used elsewhere).
The banker who submitted a memo can immediately call this endpoint and record their own
`decision: "approved"` — defeating the codebase's own stated separation-of-duties
invariant ("Buddy assembles. Banker submits. Underwriter decides.").

### H2. Narrative cache ignores `input_hash` in the actual product flow
`src/lib/creditMemo/canonical/narrativeAssembly.ts:279-296`,
`src/app/api/deals/[dealId]/credit-memo/canonical/narratives/route.ts:22-35`,
`src/components/creditMemo/GenerateNarrativesButton.tsx:13-17`

The cache lookup fetches the most recent row by `deal_id, bank_id`, not by `input_hash`,
and the "Generate Narratives" button POSTs `{}` with no `force` flag, so
`forceRegenerate` is always false in normal use. After a fact correction (e.g., DSCR
revised down), re-running narrative generation silently serves the old AI narrative
describing pre-correction numbers while the rest of the memo reflects the new numbers —
directly contradicting the documented `NARRATIVE_PRIORITY` invariant that stale
narratives must never be overlaid.

### H3. `deal_pricing_inputs` absent → `spread_bps` silently defaults to 0
covered under C7/C8 area — see Financial Calculations MEDIUM below (kept there; listed
here only for cross-reference).

### H4. Balance sheet duplicate-fact dedup takes the larger of two values
`src/lib/creditMemo/canonical/buildBalanceSheetTable.ts:~129-144`

Duplicate `SL_*` fact rows for the same period/field are deduplicated by keeping the
**larger** value, on the unverified assumption that larger = correct and smaller =
extraction garbage. Two duplicate `SL_CASH` rows of `40,000` (correct) and `4,000,000`
(a decimal mis-parse) → the code keeps `4,000,000`, silently inflating cash, current
ratio, quick ratio, and net worth with no flag.

### H5. Balance sheet fabricates a tautological balance when data is missing
`src/lib/creditMemo/canonical/buildBalanceSheetTable.ts:~172-178`

`liabilities_plus_equity` is set equal to `total_assets` whenever
`total_liabilities`/`total_equity` are missing, fabricating `assets = liabilities+equity`
instead of leaving it unresolved — this defeats any downstream reconciliation check meant
to catch genuine data-quality problems.

### H6. Management-principal dedup silently drops a real guarantor
`src/lib/creditMemo/management/buildManagementPrincipals.ts:~145-158`

An `ownership_entities` row is treated as an alias of an already-covered profile whenever
the surname token matches **and** `match.ownershipPct === (o.ownership_pct ?? null)`.
When both people have `ownership_pct` null (common for unfilled co-owners), `null ===
null` is true, so two different people sharing a surname (e.g. "Robert Chen" and "Susan
Chen") collapse into one and the second person is dropped from the memo's management/
guarantor section entirely.

### H7. Submit-to-underwriting isn't gated on in-flight autosave
`src/components/creditMemo/BankerReviewPanel.tsx:206-220` (800ms debounce) vs. 315-317
(`submitToUnderwriting`)

`submitToUnderwriting` checks `allRequiredDone`/`submissionState` but never checks
whether a text-field autosave is still pending. `submitCreditMemoToUnderwriting.ts`
rebuilds the canonical memo fresh from the DB at submit time. A banker who edits a field
and clicks "Submit to Underwriting" within the 800ms debounce window gets a frozen
snapshot that silently omits their last edit, with no error surfaced.

### H8. Resource exhaustion via unauthenticated geometry route
(See C1 — flagged again here because it's independently exploitable even if C1's auth
gap were the only issue: repeatable, unthrottled Azure OCR calls per attachment.)

---

## MEDIUM

- **Guarantor obligations understated for partial PFS data** — `src/lib/creditMemo/buildBindings.ts:190-244`. `totalPersonalDS`/`totalLiving` sum only guarantors with a matching PFS fact; a guarantor with no PFS row contributes zero rather than making the total null/partial. A 2-guarantor deal where only one has PFS debt-service on file understates `global.totalObligations`.
- **`??` fallback chain skips real data on empty string** — `buildCanonicalCreditMemo.ts:1630-1644` (`business_description`, `revenue_mix`, `seasonality`, etc.). `??` only falls through on `null`/`undefined`, not `""`, so a borrower-story field saved as `""` skips the override/qualitative fallback entirely.
- **Guarantor-income reconciliation misses one comparison pair** — `src/lib/creditMemo/globalCashFlow/reconcileGuarantorIncome.ts:~74-92`. Only compares `pfsAnnualIncome` vs. `taxReturnAgi ?? personalIncomeSpreadTotal`; never compares `taxReturnAgi` against `personalIncomeSpreadTotal` directly, so a large discrepancy between those two "verified" sources produces no warning.
- **Pricing route fabricates a 0bps spread on missing data** — `src/app/api/deals/[dealId]/credit-memo/pricing/insert/route.ts:~70-83`. When `deal_pricing_inputs` is absent, `term_months`/`amort_months` default to 120/300 and `spread_bps` falls back to `Number(quote.spread_bps ?? 0)` — inserted into the memo draft with no "data missing" indicator.
- **DB immutability trigger has an incomplete state machine** — `supabase/migrations/20260609000000_credit_memo_submission_lifecycle.sql:198-201`. Only blocks reverting to `status='draft'`; doesn't prevent other backward transitions (e.g. `finalized → banker_submitted`). Terminal states are enforced only by one application call site, not the database.
- **No supersession on resubmission** — `src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts` never marks a prior snapshot `superseded` on resubmit. Two `banker_submitted` rows can coexist for the same deal; an underwriter acting on a stale UI reference can approve/decline the superseded (v1) version while v2 sits untouched.
- **Certification runs a weaker safety guard than PDF export does** — `buildFloridaArmorySnapshot.ts:147` runs only `assertNoBlockers` at submission; the stricter `assertCommitteeMemoSafe` (placeholder scan, DSCR contradiction, AR-LOC checks) only runs later in `canonical/pdf/route.ts:1052`. A memo can be certified/frozen (and thus immutable) while still failing the stricter check, permanently blocking PDF generation short of a full resubmission.
- **Certified snapshot loader can't see post-decision snapshots** — `src/lib/creditMemo/snapshot/loadLatestCertifiedSnapshot.ts:76` filters strictly on `status='banker_submitted'`; once `recordUnderwriterDecision` moves status to `finalized`/`returned`, the loader 409s on an already-decided memo.
- **Collateral narrative contradicts the itemized collateral table** — `src/lib/creditMemo/collateral/buildCollateralNarrative.ts:73-93`. The function's own docstring lists source priority as AR → `deal_collateral_items` → legacy override → "Pending," but it never actually reads `deal_collateral_items`. A non-AR deal with fully itemized collateral (via `CollateralItemsTable`) still renders `property_description: "Pending"` even though the itemized totals are populated in the same memo.
- **Legacy business-story migration permanently short-circuits** — `src/lib/creditMemo/inputs/buildMemoInputPackage.ts:139` and the migration helpers gate on "does *any* `deal_borrower_story` row exist," not "is it complete." If a row exists with only `naics_code` set, legacy `business_description`/`revenue_mix` never migrates, and `missing_business_description` stays permanently blocking without manual re-entry.
- **AI narrative can reach a certified memo with no explicit review gate** — "AI narrative generated" is a Recommended (non-blocking), not Required, checklist item in `BankerReviewPanel.tsx:306-311`. A banker can generate and submit within seconds with no requirement to have read/edited the AI text.
- **Error messages leak internals** — `src/app/api/ai/credit-memo/route.ts:53-58`, `overrides/route.ts:76,106`, `canonical/narratives/route.ts:50` return raw `e.message`/`String(e)` in 500 bodies.
- **Committee financial rules silently disable on snapshot load failure** — `buildCommitteeAnticipation.ts:79` swallows snapshot-load errors to `null`; every repayment/leverage/liquidity/collateral rule then no-ops (same fail-open pattern as C6, independent code path).

---

## LOW / plausible (lower confidence, worth a look)

- `leverageRules.ts:15` only evaluates debt/EBITDA when `ebitda_ttm > 0`, skipping the check entirely for zero/negative EBITDA — arguably the worst case to skip.
- `liquidityRules.ts:14` divides `pfs_total_assets` (can include illiquid real estate) by monthly debt service rather than a liquid-assets figure — a proxy that can overstate a sponsor's actual liquidity.
- `concentrationRules.ts:11` uses a narrow negation regex that can misread phrasing like "does not have a single customer over 20%" (false-positive direction only).
- `intelligence/route.ts:24` uses a page-oriented `requireDealAccess` that issues an HTTP redirect on auth failure instead of a JSON error, inconsistent with sibling API routes' error contract.
- `buildBindings.ts:77-79` DEAL-owner filter lets facts with a falsy/null `owner_type` bind to DEAL-level fields — possibly intentional legacy handling, flagging for awareness only.
- `extractCollateralFromDocuments.ts:152` takes the worst per-fact confidence as an item's overall confidence — defensible on its own, but compounds the collateral-narrative inconsistency above.

---

## Recommended remediation order

1. **C1–C4** (all cross-tenant IDOR / missing bank_id checks) — these are live data-leak
   vectors across a live production credit-memo system and should be fixed first,
   independent of everything else.
2. **C5–C6** (committee gate: wrong table name, fail-open on load error) — these mean the
   policy-exception safety net is currently a no-op in production.
3. **C7–C8** (ratio mislabeling, missing-data-as-weak-data) — these can silently alter a
   credit decision or risk grade and should be fixed before the next committee cycle.
4. **H1–H7**, then the MEDIUM list, roughly in the order listed.

No fixes have been applied — this document is audit-only, as requested.
