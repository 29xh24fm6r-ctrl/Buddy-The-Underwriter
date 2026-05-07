# SPEC-13.5 — Complete the SPEC-13 Cutover

**Path (when committed):** `specs/banker-flow-v1/SPEC-13.5-complete-cutover.md`
**Status:** Ready for Claude Code
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** `main`
**Depends on:** SPEC-13 (banker road consolidation, partially landed), SPEC-FLOW-V1 PR1 (BankerReviewPanel mounted on credit-memo page, landed at 2647e1a4)
**Blocks:** SPEC-FLOW-V1 PR2-PR5 (do not continue until SPEC-13.5 verifies V-12 passes)
**Related canonical reference:**
- `src/lib/creditMemo/inputs/migrateLegacyOverridesAsync.ts` (the broken bridge)
- `src/lib/creditMemo/inputs/migrateLegacyOverridesToCanonical.ts` (the pure transform)
- `src/lib/creditMemo/inputs/upsertBorrowerStory.ts` (the writer that silently fails)
- `src/lib/creditMemo/inputs/buildMemoInputPackage.ts` (the caller that swallows failures)
- `src/components/creditMemo/MemoCompletionWizard.tsx` (still POSTing to legacy table)
- `src/app/api/deals/[dealId]/credit-memo/overrides/route.ts` (the legacy writer endpoint)
- `src/components/creditMemo/BankerReviewPanel.tsx` (also writes to legacy via the same endpoint)

---

## Problem in one paragraph

End-to-end V-12 verification of SPEC-FLOW-V1 PR1 surfaced a structural defect that has been silently broken since SPEC-13's original implementation: the banker road has two completely disconnected qualitative-input plumbing systems. **System A (legacy)** stores qualitative inputs in `deal_memo_overrides` as a single jsonb blob — currently 4 deals carry 97–1,695 chars of business descriptions and management bios there. **System B (canonical)** is the post-SPEC-13 store comprising `deal_borrower_story`, `deal_management_profiles`, and `deal_collateral_items` — the entire production database has **zero rows** in the first two of these tables despite the migration helper running on every credit-memo page load. The bridge between them — `migrateLegacyOverridesToCanonical` — exists, is wired into `buildMemoInputPackage`, and silently produces zero writes every time it executes. Three failures stacked: the wrapper swallows the writer's `{ ok: false }` return value with no telemetry, the writer's tenant access check returns false in some server contexts, and the wizard plus BankerReviewPanel auto-save both still POST to the legacy endpoint. Result: every banker who has ever opened a credit memo on a real deal has hit an impassable submission gate, and no UI in the system writes to the canonical store. SPEC-FLOW-V1 PR1 made this visible by mounting the BankerReviewPanel — its checklist correctly fails on canonical-store-empty, the Submit button correctly stays disabled, and the road remains unwalkable.

## Solution in one paragraph

SPEC-13.5 completes the SPEC-13 cutover with structural commitment: pick one store (canonical), migrate all data into it, rewire all writers to it, prove the migration helper actually works, add CI guards that fail when the legacy store gets written to, and schedule legacy table deletion after a 14-day observation window of zero new legacy writes. Three sequential PRs, each independently shippable. PR-A fixes the migration helper bug, adds telemetry around every migration call, and runs a one-time backfill against the 4 deals with legacy data — V-12 must pass on at least one real deal at the end of PR-A. PR-B rewires the wizard and the BankerReviewPanel auto-save to write through the canonical helpers (`upsertBorrowerStory` + `upsertManagementProfile`) instead of the legacy `/credit-memo/overrides` endpoint, and the legacy endpoint becomes a deprecation shim that returns 200 but writes nothing. PR-C adds a CI guard that fails the build if any non-test code references `deal_memo_overrides` for writes, opens the 14-day observation window, and queues legacy table deletion for the day-15 PR. No new tables. No lifecycle model changes. No edits to `evaluateMemoInputReadiness` (the contract is right; the data feeding it is wrong). Total estimated work: 3 days. Targeted outcome: first end-to-end credit memo submission within 24 hours of PR-A merge; zero legacy writes within 7 days; legacy table dropped within 21 days.

---

## PIV — pre-implementation verification (mandatory)

Run each PIV in order. Paste the actual command output into the AAR for each one. Do not skip.

### PIV-1. Confirm canonical store is empty across all banks

```sql
SELECT
  'deal_borrower_story' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT deal_id) AS distinct_deals,
  MAX(updated_at)::text AS most_recent_write
FROM deal_borrower_story
UNION ALL
SELECT 'deal_management_profiles', COUNT(*), COUNT(DISTINCT deal_id), MAX(updated_at)::text
FROM deal_management_profiles
UNION ALL
SELECT 'deal_collateral_items', COUNT(*), COUNT(DISTINCT deal_id), MAX(updated_at)::text
FROM deal_collateral_items
UNION ALL
SELECT 'deal_memo_overrides (legacy)', COUNT(*), COUNT(DISTINCT deal_id), MAX(updated_at)::text
FROM deal_memo_overrides;
```

**Expected:** `deal_borrower_story` and `deal_management_profiles` both show 0 rows / null most_recent_write. `deal_memo_overrides` shows ~4 rows. If borrower_story is no longer empty, the migration may have started working between this audit and PIV — **stop and report**, the spec's premise needs refresh.

### PIV-2. Identify exact deals with legacy data that need backfill

```sql
SELECT
  d.id,
  d.display_name,
  d.borrower_name,
  length(coalesce(o.overrides->>'business_description', '')) AS biz_desc_len,
  (SELECT count(*) FROM jsonb_object_keys(o.overrides) k WHERE k LIKE 'principal_bio_%') AS principal_bio_count,
  jsonb_object_keys(o.overrides) AS sample_keys
FROM deals d
JOIN deal_memo_overrides o ON o.deal_id = d.id
WHERE jsonb_typeof(o.overrides) = 'object'
ORDER BY d.created_at DESC
LIMIT 20;
```

**Expected:** the list of deals to backfill, with their key shapes. Paste the full result. PR-A's backfill validation will assert canonical-store rows for each of these deal_ids after the migration runs.

### PIV-3. Confirm `migrateLegacyOverridesAsync` is called from `buildMemoInputPackage`

```bash
grep -n "migrateLegacyOverridesToCanonical" src/lib/creditMemo/inputs/buildMemoInputPackage.ts
```

**Expected:** at least one hit. Confirms the wiring is in place; the bug is in the writer, not the caller.

### PIV-4. Confirm `upsertBorrowerStory` calls `ensureDealBankAccess`

```bash
grep -n "ensureDealBankAccess" src/lib/creditMemo/inputs/upsertBorrowerStory.ts src/lib/creditMemo/inputs/upsertManagementProfile.ts
```

**Expected:** both files call it. Confirms the suspected silent-failure path in Failure 1 of the audit.

### PIV-5. Confirm the wrapper swallows `{ ok: false }` returns silently

```bash
grep -n "out.ok\|borrowerStoryWritten\|managementWrites" src/lib/creditMemo/inputs/migrateLegacyOverridesAsync.ts
grep -n "migrateLegacyOverridesToCanonical\|borrowerStoryWritten" src/lib/creditMemo/inputs/buildMemoInputPackage.ts
```

**Expected:** the wrapper tracks `borrowerStoryWritten` from `out.ok`, but `buildMemoInputPackage` does not inspect the return value — it just calls `await migrateLegacyOverridesToCanonical({...})` inside try/catch and discards the result. Confirms Failure 3.

### PIV-6. Confirm the wizard and BankerReviewPanel both POST to the legacy endpoint

```bash
grep -n "credit-memo/overrides" src/components/creditMemo/MemoCompletionWizard.tsx src/components/creditMemo/BankerReviewPanel.tsx
```

**Expected:** at least one POST in each file pointing to `/api/deals/[dealId]/credit-memo/overrides`. Confirms PR-B is needed.

### PIV-7. Confirm the legacy endpoint writes to `deal_memo_overrides`

```bash
grep -n "deal_memo_overrides" src/app/api/deals/\[dealId\]/credit-memo/overrides/route.ts
```

**Expected:** at least one write. PR-B converts this to a deprecation no-op shim.

### PIV-8. Confirm zero credit memo snapshots have ever been written (the headline metric, unchanged from PIV-9 of SPEC-FLOW-V1)

```sql
SELECT COUNT(*) FROM credit_memo_snapshots;
```

**Expected:** 0. After PR-A lands and a real V-12 walk completes, this becomes ≥ 1.

### PIV-9. Confirm no Clerk session is required for the migration's intended call sites

Read `src/lib/creditMemo/inputs/buildMemoInputPackage.ts` carefully. Confirm that all three call sites (the `/credit-memo` page, the `/memo-inputs` page, and `submitCreditMemoToUnderwriting`) execute inside a request context where `clerkAuth()` returns a valid `userId`. Paste the call-site list into the AAR.

If any call site is server-only (cron, webhook, background job), document it — PR-A's writer fix must accommodate the no-session case.

---

## Scope

### In scope (this spec)

#### PR-A — Fix the migration, add telemetry, backfill the 4 deals

The single highest-leverage PR in this spec. End state: V-12 passes on at least one real deal. The road becomes walkable.

**A-1. Audit the writer's access check failure mode.** Read `upsertBorrowerStory.ts` and `upsertManagementProfile.ts` and identify why `ensureDealBankAccess` might return false in the migration's call path. Three possibilities to investigate:

- The Clerk session is missing in some server context (verify against PIV-9 results)
- The deal's `bank_id` doesn't match the resolved `userBankId` from `getCurrentBankId` (multi-tenant path issue)
- An exception is being thrown inside `clerkAuth()` and caught by the wrapper

Paste findings into the AAR.

**A-2. Refactor the writers to accept an optional pre-resolved `bankId`.** When called from a context that has already resolved the bank (e.g., `migrateLegacyOverridesAsync` which receives `bankId` as a parameter), allow the writer to skip the access check and use the supplied `bankId`. New signature:

```ts
export type UpsertBorrowerStoryArgs = {
  dealId: string;
  patch: Partial<...>;
  source?: DealBorrowerStory["source"];
  confidence?: number | null;
  // SPEC-13.5: optional pre-resolved bank scope. When supplied, skips
  // ensureDealBankAccess. Caller is responsible for tenant verification.
  trustedBankId?: string;
};
```

Apply the same to `upsertManagementProfile`. Update `migrateLegacyOverridesAsync` to pass `trustedBankId: args.bankId` on every upsert call.

**A-3. Make the wrapper and caller surface migration failures.** Update `migrateLegacyOverridesAsync` to throw on any unexpected writer failure (not just collect counts). Update `buildMemoInputPackage` to:

- Capture the migration result (success counts + skip reasons)
- Write a `memo_input.legacy_migration` audit event with deal_id, bank_id, borrower_story_written, management_writes, skipped_reason
- Log to console at WARN level when the migration runs but writes 0 rows when it should have written something (i.e., legacy overrides exist but no useful keys mapped)

This is the single most important change. The bug existed for 2 months because nothing told us it was happening.

**A-4. Backfill the 4 deals identified in PIV-2.** Write a one-time script `scripts/spec-13-5-backfill.ts` that:

1. Queries `deal_memo_overrides` for all rows with non-empty `overrides`
2. For each, calls `migrateLegacyOverridesToCanonical` with `trustedBankId` from the deal's `bank_id`
3. Asserts at least 1 borrower_story write per deal that HAS a business_description ≥ 20 chars in its legacy overrides. Deals with no business_description (or < 20 chars) produce zero borrower_story rows — this is correct, not a failure.
4. Asserts at least 1 management_profile write per deal that HAS at least one principal_bio_* key with ≥ 20 chars of content. Deals with no principal_bio_* keys produce zero management_profile rows — also correct.
5. Writes a backfill audit event per deal with the result counts
6. Per-deal output: legacy_keys_found, borrower_story_writes, management_profile_writes, skipped_reason (when applicable). Test Pack 4-23-26 #1 (e505cd1c-86b4-4d73-88e3-bc71ef342d94) is the expected zero-output case (only banker_summary key in overrides, no canonical-mappable content). Document this in the script's output for clarity — it's not a failure.

Run via `pnpm tsx scripts/spec-13-5-backfill.ts`. Paste full output into AAR.

**A-5. V-12 walk.** After backfill completes, **manually walk V-12 in the browser** on whichever of the 4 deals has the most realistic data (likely OmniCare 365 May 1 with 580 chars + multiple principals, or OmniCare 365 Review with 1,695 chars). Same V-12 protocol as SPEC-FLOW-V1: navigate to credit-memo page → expand BankerReviewPanel → confirm checklist shows all ✓ → click Submit → confirm green success state with snapshot ID.

Then confirm via SQL:

```sql
SELECT id, status, submitted_at, memo_version, deal_id
FROM credit_memo_snapshots
ORDER BY submitted_at DESC;
```

**At least one row must appear.** Paste into AAR.

**A-6. Tests.**

- Unit: `migrateLegacyOverridesAsync.test.ts` — mock the writers, assert the wrapper passes `trustedBankId` correctly.
- Unit: `upsertBorrowerStory.trustedBankId.test.ts` — assert that supplying `trustedBankId` skips `ensureDealBankAccess`.
- Integration: `buildMemoInputPackage.migrationTelemetry.test.ts` — call against a test deal with empty borrower_story but populated legacy overrides, assert audit event written and borrower_story row appears.
- Regression: existing `evaluateMemoInputReadiness.test.ts` and `submitCreditMemoToUnderwriting.test.ts` continue to pass.

#### PR-B — Rewire writers to canonical store, deprecate legacy endpoint

End state: zero new writes to `deal_memo_overrides` from any UI surface. Wizard and BankerReviewPanel auto-save both write through canonical helpers.

**B-1. Create the new canonical write endpoint.** `POST /api/deals/[dealId]/memo-inputs/from-wizard` accepts the wizard's payload shape (a flat object with `business_description`, `revenue_mix`, `seasonality`, `principal_bio_<id>` keys) and:

1. Calls `ensureDealBankAccess(dealId)` for tenant verification
2. Maps the payload onto the canonical schema (same mapping as `transformLegacyOverrides`)
3. Calls `upsertBorrowerStory` and `upsertManagementProfile` directly with `trustedBankId`
4. Returns `{ ok: true, borrower_story: {...}, management_profiles: [...] }`
5. Writes a `memo_input.wizard_save` audit event

**B-2. Rewire `MemoCompletionWizard`.** Change the POST URL from `/credit-memo/overrides` to `/memo-inputs/from-wizard`. Update payload shape if needed. Remove any references to `deal_memo_overrides` in the component.

Also: the wizard contains a stale comment at MemoCompletionWizard.tsx:45 claiming the legacy endpoint "is now a deprecation no-op shim" — it isn't (PR-B is what makes that true). Remove the stale comment when rewiring the POST. The presence of this comment confirms SPEC-13's original cutover was abandoned mid-flight; the comment landed without the corresponding code change.

**B-3. Rewire `BankerReviewPanel` auto-save.** The component currently POSTs to `/credit-memo/overrides` for both reads and writes. For SPEC-13.5:

- Reads continue to work (the legacy endpoint's GET still returns `deal_memo_overrides` content)
- Writes split: the qualitative content (business_description, revenue_mix, seasonality, principal_bio_*) routes through `/memo-inputs/from-wizard`. UI-only state (tabs_viewed, qualitative_override_*, covenant_adjustments) stays at the legacy endpoint for now (separate consolidation)
- The component's `saveOverrides` helper grows a `routePartition()` step that splits the patch into "canonical fields" and "ui-state fields" and POSTs each to its appropriate endpoint

**B-4. Convert legacy endpoint POST to a deprecation no-op shim.**

```ts
// /api/deals/[dealId]/credit-memo/overrides
// POST: returns 200 with deprecation flag. Does NOT write to deal_memo_overrides.
// SPEC-13.5: keep for one deploy cycle so any in-flight client doesn't 404.
// Removal scheduled for SPEC-13.5 PR-C + 14 days.
return NextResponse.json({
  ok: true,
  deprecated: true,
  message: "Endpoint deprecated. Writes routed through /memo-inputs/from-wizard.",
});
```

GET stays functional so legacy data remains readable.

**B-5. Tests.**

- Unit: `routePartition.test.ts` — verify split between canonical fields and UI-state fields.
- Integration: `from-wizard-route.test.ts` — POST canonical payload, assert rows in `deal_borrower_story` and `deal_management_profiles`.
- Component: `BankerReviewPanel.dualWrite.test.tsx` — assert qualitative writes hit canonical endpoint, UI-state writes hit legacy.
- Regression: legacy endpoint POST returns 200 with `deprecated: true`. Legacy endpoint GET still returns existing data unchanged.

#### PR-C — CI guard, observation window, queued deletion

End state: structural commitment to single-source-of-truth. Legacy table on path to deletion.

**C-1. CI guard.** Add a script `scripts/check-no-legacy-overrides-writes.sh` that fails the build if any non-test file in `src/` contains:

- `.from("deal_memo_overrides")...insert(`
- `.from("deal_memo_overrides")...update(`
- `.from("deal_memo_overrides")...upsert(`
- `.from("deal_memo_overrides")...delete(`

Reads (`.select(`) are still allowed for the deprecation shim's GET path. Add the script to `.github/workflows/ci.yml` as a required check.

**C-2. Observation window dashboard.** Add a daily aggregate query that runs via the existing telemetry infrastructure:

```sql
CREATE OR REPLACE VIEW spec_13_5_legacy_writes_observation AS
SELECT
  date_trunc('day', updated_at) AS day,
  COUNT(*) AS legacy_writes
FROM deal_memo_overrides
WHERE updated_at > NOW() - INTERVAL '21 days'
GROUP BY 1
ORDER BY 1 DESC;
```

After 14 consecutive days of `legacy_writes = 0`, schedule the day-15 PR.

**C-3. Queue legacy table deletion.** File a follow-up ticket at `specs/follow-ups/SPEC-13.5-table-deletion.md`:

```
## SPEC-13.5 PR-D — Drop legacy deal_memo_overrides table
Status: Queued, blocked by 14-day observation window
Earliest execution date: [PR-C deploy date + 14 days]

Pre-conditions:
1. spec_13_5_legacy_writes_observation view shows 14 consecutive days of zero writes
2. CI guard from PR-C has been merged for 14 days with no exceptions
3. All 4 deals identified in PIV-2 have canonical-store rows confirmed

Action:
- Migration: DROP TABLE deal_memo_overrides
- Remove the deprecation shim endpoint
- Remove all GET-side references in the codebase
- Update SPEC-13 follow-up ticket as resolved
```

**C-4. Tests.**

- Script test: `check-no-legacy-overrides-writes.test.ts` — synthetic source files with each forbidden pattern fail the script; reads pass.
- Integration: assert the dashboard view exists and returns expected shape.

### Out of scope (explicitly)

- Touching `evaluateMemoInputReadiness`. The contract is correct; the data feeding it is wrong.
- Lifecycle model edits. Zero changes to `src/buddy/lifecycle/model.ts`.
- New blocker codes. Existing `missing_business_description`, `missing_management_profile`, `missing_collateral_*` blockers cover everything.
- Voice / transcript pipeline write targets. Separate consolidation, separate spec.
- Builder Story step write target. Separate consolidation.
- Underwriter or committee surfaces.
- Borrower portal flow.
- The 4 stash items from prior sessions (committee-anticipation, doc-engine WIP, etc.) — out of this spec's lane.

---

## Tests

(See per-PR test sections in Scope above. Aggregate summary below.)

### Unit

- `migrateLegacyOverridesAsync.trustedBankId.test.ts` (PR-A)
- `upsertBorrowerStory.trustedBankId.test.ts` (PR-A)
- `upsertManagementProfile.trustedBankId.test.ts` (PR-A)
- `routePartition.test.ts` (PR-B)
- `check-no-legacy-overrides-writes.test.ts` (PR-C)

### Integration

- `buildMemoInputPackage.migrationTelemetry.test.ts` (PR-A)
- `from-wizard-route.test.ts` (PR-B)

### Component

- `BankerReviewPanel.dualWrite.test.tsx` (PR-B)

### E2E (manual)

- V-12 walk on a real backfilled deal at end of PR-A
- V-12 walk on a fresh deal (no legacy overrides) at end of PR-B (proves wizard rewire works)

### Regression

- `pnpm test` clean across all three PRs
- `pnpm tsc --noEmit` clean across all three PRs
- All SPEC-13 / SPEC-FLOW-V1 / SPEC-INTAKE-V2 tests continue to pass

---

## V-N verification checklist (each item must be checked off in AAR)

- V-1. ☐ All 9 PIV outputs pasted into AAR; if any expectation failed, work paused.
- V-2. ☐ PR-A A-1 — root cause of writer access-check failure documented in AAR.
- V-3. ☐ PR-A A-2 — `trustedBankId` parameter shipped on both upsert helpers; existing call sites unchanged (backwards compatible).
- V-4. ☐ PR-A A-3 — `memo_input.legacy_migration` audit event fires on every migration call. Verified via:

```sql
SELECT kind, COUNT(*) FROM audit_ledger
WHERE kind = 'memo_input.legacy_migration'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY kind;
```

After three test page loads on different deals, count should be ≥ 3.

- V-5. ☐ PR-A A-4 — backfill script run; output pasted into AAR. All 4 deals from PIV-2 now have canonical-store rows. Verify via:

```sql
SELECT
  d.id,
  d.display_name,
  (SELECT COUNT(*) FROM deal_borrower_story WHERE deal_id = d.id) AS bs,
  (SELECT COUNT(*) FROM deal_management_profiles WHERE deal_id = d.id) AS mp
FROM deals d
WHERE d.id IN ([the 4 deal IDs from PIV-2])
ORDER BY d.id;
```

Every row must show `bs ≥ 1` and `mp ≥ 1` (where the deal had `principal_bio_*` legacy keys).

- V-6. ☐ PR-A A-5 — **HEADLINE METRIC.** V-12 walked on a real backfilled deal. `credit_memo_snapshots` query returns ≥ 1 row with `status='banker_submitted'`. Snapshot row pasted into AAR.

- V-7. ☐ PR-B B-1 — `/api/deals/[dealId]/memo-inputs/from-wizard` route exists. POST returns ok and writes to canonical tables. Tested against a fresh test deal.

- V-8. ☐ PR-B B-2 — `MemoCompletionWizard` POSTs only to `/memo-inputs/from-wizard`. Confirmed via grep:

```bash
grep -n "credit-memo/overrides" src/components/creditMemo/MemoCompletionWizard.tsx
```

Expected: zero hits after PR-B.

- V-9. ☐ PR-B B-3 — `BankerReviewPanel` partitions writes correctly. Component test passing.
- V-10. ☐ PR-B B-4 — legacy endpoint POST returns deprecation shim. Confirmed via:

```bash
curl -X POST [dev]/api/deals/[any deal]/credit-memo/overrides -H "Content-Type: application/json" -d '{"overrides":{"business_description":"test"}}'
```

Expected: 200 with `{ ok: true, deprecated: true, ... }`. Verify in DB that `deal_memo_overrides` did NOT receive a write:

```sql
SELECT updated_at FROM deal_memo_overrides WHERE deal_id = '[the deal]';
```

- V-11. ☐ PR-B — fresh deal V-12 walk. Create a brand-new test deal, walk through to credit memo, fill BankerReviewPanel inputs (which now write to canonical), submit. Snapshot row appears. This proves the road is walkable for new deals, not just backfilled ones.
- V-12. ☐ PR-C C-1 — CI guard script shipped, integrated into workflow, fails on synthetic forbidden writes.
- V-13. ☐ PR-C C-2 — observation view exists; daily run scheduled.
- V-14. ☐ PR-C C-3 — follow-up ticket `specs/follow-ups/SPEC-13.5-table-deletion.md` filed.
- V-15. ☐ Post-deploy 24h check (after each PR):

```sql
SELECT
  COUNT(*) AS new_snapshots_24h,
  COUNT(DISTINCT deal_id) AS distinct_deals
FROM credit_memo_snapshots
WHERE submitted_at > NOW() - INTERVAL '24 hours';
```

After PR-A: ≥ 1 (the V-12 walk). After PR-B: ≥ 1 (cumulative). After PR-C: continued growth.

- V-16. ☐ Day-7 sanity check (run 7 days after PR-C deploy):

```sql
SELECT date_trunc('day', updated_at), COUNT(*) AS legacy_writes
FROM deal_memo_overrides
WHERE updated_at > NOW() - INTERVAL '7 days'
GROUP BY 1 ORDER BY 1 DESC;
```

Expected: zero writes for at least the last 7 days. If any legacy writes appear, identify the source code path (CI guard should have caught it; if it didn't, fix the guard).

- V-17. ☐ `pnpm tsc --noEmit` clean.
- V-18. ☐ `pnpm test` clean.

---

## Files affected

### New files

| Path | Purpose |
|------|---------|
| `scripts/spec-13-5-backfill.ts` | One-time backfill of 4 legacy deals (PR-A) |
| `src/app/api/deals/[dealId]/memo-inputs/from-wizard/route.ts` | New canonical write endpoint (PR-B) |
| `scripts/check-no-legacy-overrides-writes.sh` | CI guard (PR-C) |
| `specs/follow-ups/SPEC-13.5-table-deletion.md` | Day-15 deletion ticket (PR-C) |
| Tests listed in Tests section above |

### Modified files

| Path | Change | PR | Risk |
|------|--------|----|------|
| `src/lib/creditMemo/inputs/upsertBorrowerStory.ts` | Add `trustedBankId` parameter | A | Low — additive, backwards compatible |
| `src/lib/creditMemo/inputs/upsertManagementProfile.ts` | Add `trustedBankId` parameter | A | Low |
| `src/lib/creditMemo/inputs/migrateLegacyOverridesAsync.ts` | Pass `trustedBankId`, throw on writer failure | A | Med — error propagation change |
| `src/lib/creditMemo/inputs/buildMemoInputPackage.ts` | Capture migration result, write audit event | A | Low |
| `src/components/creditMemo/MemoCompletionWizard.tsx` | Change POST URL | B | Low |
| `src/components/creditMemo/BankerReviewPanel.tsx` | Partition writes between canonical and legacy endpoints | B | Med — UX-adjacent |
| `src/app/api/deals/[dealId]/credit-memo/overrides/route.ts` | Convert POST to deprecation shim | B | Low |
| `.github/workflows/ci.yml` | Add CI guard step | C | Low |

### Migrations

| Name | Purpose | PR |
|------|---------|----|
| (none in PR-A or PR-B) | Backfill is a script, not a migration | — |
| `spec_13_5_observation_view` | Create observation view | C |
| `spec_13_5_drop_legacy_table` | DROP TABLE deal_memo_overrides | PR-D, deferred 14 days |

No new tables. No lifecycle model edits.

---

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Backfill script writes wrong data into canonical store for one of the 4 deals | Script asserts post-conditions (`bs ≥ 1` and `mp ≥ 1`) per deal. If assertions fail, the script halts and surfaces the deal_id. Re-runnable safely (idempotency guard in `migrateLegacyOverridesAsync` prevents double-writes). |
| 2 | `trustedBankId` becomes a backdoor that bypasses tenant isolation | The parameter is internal-only (no API surface); only callers that have already resolved the bank scope should use it. Add a code comment noting the security expectation. PR review must verify no API route accepts `trustedBankId` from request body. |
| 3 | Removing the silent-swallow makes failures loud and breaks production for users mid-flight | The migration failure is currently silent — making it loud surfaces existing bugs immediately. This is the point. If a real production deal fails migration after PR-A deploys, that's a P0 to investigate, not a reason to keep failures silent. |
| 4 | BankerReviewPanel's split-write logic breaks UI-state persistence (tabs_viewed, qualitative overrides) | The split is well-defined: anything that lives in `deal_memo_overrides.overrides` jsonb without a canonical equivalent stays at the legacy endpoint for one more cycle. Component test asserts both endpoints receive their portion. |
| 5 | Legacy endpoint deprecation shim returns 200 but the wizard expects a specific response shape | Test the shim's response shape against MemoCompletionWizard's parser. Maintain the existing `{ ok: true, overrides: {...} }` shape for one deploy cycle even though `overrides` is empty. |
| 6 | CI guard catches a legitimate read pattern as a forbidden write | Pattern matches only `.insert(`, `.update(`, `.upsert(`, `.delete(` after `.from("deal_memo_overrides")`. Reads via `.select(` are explicitly allowed. Test with synthetic positive AND negative cases. |
| 7 | Observation window shows residual writes from forgotten code paths | If V-16 surfaces any legacy writes, the CI guard failed. Fix the guard pattern and add the missed code path to the test fixtures. Restart the 14-day window. |
| 8 | Day-15 table drop runs while a query is mid-flight against deal_memo_overrides | DROP TABLE locks briefly; queries fail loudly if mid-flight. Schedule for off-hours. Coordinate with deploy window. |
| 9 | A NEW deal created after PR-A deploy has empty canonical store and no legacy fallback | This is the expected new state. Bankers must fill the BankerReviewPanel inputs themselves (which now write canonical). The wizard rewire in PR-B makes this work. V-11 explicitly tests this. |
| 10 | The investigation in A-1 reveals that the writer's failure is in `getCurrentBankId`, not `clerkAuth` | If so, the fix changes (different parameter name, different scope), but the spec's structure stands. Document the actual root cause in AAR; adapt A-2's parameter name accordingly. |

---

## Hand-off commit message

```
spec(banker-flow): SPEC-13.5 complete the SPEC-13 cutover — fix the bridge that has been silently broken

End-to-end V-12 verification of SPEC-FLOW-V1 PR1 surfaced a structural defect:
the banker road has two completely disconnected qualitative-input plumbing
systems. Legacy (deal_memo_overrides) holds 4 deals with real banker content.
Canonical (deal_borrower_story + deal_management_profiles) is empty across
the entire production database — zero rows, ever. The migration helper
between them exists, runs on every credit-memo page load, and silently
produces zero writes.

Three failure modes stacked: (1) writer's tenant access check fails in
some server contexts, (2) wrapper swallows {ok: false} returns with no
telemetry, (3) wizard and BankerReviewPanel both still POST to legacy
endpoint. Result: every banker who has ever opened a credit memo on a
real deal has hit an impassable submission gate.

Three sequential PRs:

PR-A — Fix the migration, add telemetry, backfill 4 deals.
  - Add trustedBankId parameter to upsertBorrowerStory + upsertManagementProfile
  - Wrapper throws on writer failure instead of silently counting zero
  - buildMemoInputPackage writes memo_input.legacy_migration audit event
  - One-time backfill script with post-condition assertions
  - Manual V-12 walk on a backfilled deal — first credit_memo_snapshots row
    in production history

PR-B — Rewire writers to canonical store.
  - New /memo-inputs/from-wizard endpoint
  - MemoCompletionWizard POSTs to canonical
  - BankerReviewPanel partitions writes (canonical for content, legacy for
    UI state — separate consolidation)
  - Legacy /credit-memo/overrides POST becomes deprecation no-op shim

PR-C — CI guard + observation window + queued deletion.
  - CI guard fails build on writes to deal_memo_overrides
  - Observation view tracks legacy writes daily
  - Follow-up ticket files day-15 table drop

No new tables. No lifecycle model edits. No edits to evaluateMemoInputReadiness.

Targets:
- First end-to-end credit memo submission within 24h of PR-A merge
- Zero legacy writes within 7 days of PR-B merge
- Legacy table dropped within 21 days of PR-C merge

PIV mandates 9 verification queries before code is written.
V-N has 18 verification items including post-PR-A V-12 walk on a real deal
and post-PR-B V-12 walk on a fresh deal (proving the road works for new
deals, not just backfilled ones).
```

---

## Addendum — non-obvious rules

1. **PR-A is the unblock.** It is the single PR that lets V-12 pass. PR-B and PR-C make the system structurally sound, but PR-A is what gets the road walked. If for any reason this spec gets paused mid-execution, PR-A alone delivers the headline value.

2. **Do not skip the audit event in A-3.** The bug existed for 2 months because nothing told us it was happening. Telemetry on every migration call is the structural fix that prevents recurrence. Without the audit event, the next silent failure goes undetected for another 2 months.

3. **`trustedBankId` is internal-only.** It must never appear in an API route's accepted parameters. If a future developer is tempted to expose it, they're creating a tenant-isolation bypass. PR review checklist item: "search every modified file for `trustedBankId` and confirm it's only in internal helper signatures, not request handlers."

4. **The legacy endpoint shim must keep its GET working.** Reads are still needed for the BankerReviewPanel's UI-state hydration and for any backwards-compat code paths. Only the POST is neutered.

5. **The 14-day observation window starts when PR-C deploys, not when PR-C merges.** Document the actual deploy date in the day-15 follow-up ticket.

6. **V-6 (the headline metric) and V-11 (fresh-deal walk) are both required.** V-6 proves the backfill works. V-11 proves new deals work. Either alone is insufficient — both must be checked off before declaring the spec done.

7. **The wizard removal from credit-memo page (SPEC-FLOW-V1 PR1 Fix #1c) means MemoCompletionWizard is no longer mounted on the canonical credit-memo route.** It may still be mounted on `/credit-memo/[dealId]/canonical/page.tsx` (the legacy print route). Confirm via grep during PR-B; if mounted, rewire it. If not, B-2 just updates the component file for future use.

8. **`deal_collateral_items` already has 5 rows** — collateral has a different write path (extraction pipeline). Do not include it in this spec. The collateral path apparently works; the borrower-story and management-profiles paths do not.

9. **The follow-up ticket from SPEC-FLOW-V1 PR1 (`specs/follow-ups/SPEC-FLOW-V1-blockers.md`) should be updated** when SPEC-13.5 closes — mark the SPEC-13 Fix #4 entry as "resolved by SPEC-13.5 PR-B." Don't delete the entry, mark it.

10. **The bank_id resolution in `migrateLegacyOverridesAsync` must use `args.bankId`, NOT call `getCurrentBankId()` again.** The wrapper receives a trusted bank scope from `buildMemoInputPackage`. Re-resolving introduces the same access-check failure mode. Code comment must mark the bank_id source as "trusted from caller, do not re-resolve."

11. **AAR must include before/after metrics for V-15 and V-16.** Pre-deploy: paste the PIV-1 result (zeros). Post-PR-A 24h: paste V-15 result (≥ 1 snapshot). Post-PR-C day-7: paste V-16 result (zero legacy writes). The numbers are the proof.

12. **No new lifecycle blockers.** SPEC-13's blockers (`missing_business_description`, `missing_management_profile`) are correct; they were just blocking deals because the data could never reach the canonical store. After SPEC-13.5, the data reaches the store and the blockers correctly clear.

13. **The CommitteeAnticipationPanel work in stash@{0} is still queued for SPEC-FLOW-V1 PR2.** SPEC-13.5 does not touch it. After SPEC-13.5 PR-A makes V-12 pass, SPEC-FLOW-V1 PR2 (CommitteeAnticipationPanel) becomes unblocked.

14. **The doc-engine-upgrade work in stash@{2} stays stashed.** SPEC-13.5 is banker-flow work, not doc-engine work. Don't touch the stash.

---

End of SPEC-13.5.
