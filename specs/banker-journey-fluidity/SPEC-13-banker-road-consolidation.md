# SPEC-13 — Banker Road Consolidation

**Path:** `specs/banker-journey-fluidity/SPEC-13-banker-road-consolidation.md`
**Status:** Ready for Claude Code
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** `main`
**Depends on:** SPEC-01 (Journey Rail, shipped), SPEC-04 (memo input gate, shipped), SPEC-06 (lifted summary surfaces, shipped)
**Related canonical reference:** `src/lib/creditMemo/inputs/evaluateMemoInputReadiness.ts`, `src/components/journey/stageViews/*`, `src/app/(app)/deals/[dealId]/credit-memo/page.tsx`

---

## Problem in one paragraph

End-to-end review of the live banker road on Samaritus (`0279ed32-c25c-4919-b231-5790050331dd`) — 9/9 docs classified, 169 financial facts, narratives generated, journey rail rendering — found five concrete friction points that turn an architecturally clean road into a bumpy one in practice. The Samaritus deal cannot pass the new memo-inputs gate today because `deal_borrower_story` is empty (0 rows) and `deal_management_profiles` is empty (0 rows), even though `deal_memo_overrides` already contains banker-entered business_description, revenue_mix, seasonality, principal_bio_*, and collateral_description for the same deal. Five different surfaces today let a banker enter the same qualitative content, three of them write to legacy storage that the new gate ignores. The `/credit-memo` route silently redirects to `/memo-inputs` when the gate fails, the CommitteeStageView's "Open Memo" link is not readiness-aware so produces a 4-hop loop, the prefill engine doesn't read legacy banker overrides as suggestions, and SPEC-06's "lifted summary surface + legacy panel beneath" pattern produces visual doubling on first paint of DocumentsStageView and UnderwritingStageView.

## Solution in one paragraph

Five surgical, narrowly-scoped fixes that consolidate the banker road around `deal_borrower_story` / `deal_management_profiles` / `deal_collateral_items` as the canonical qualitative-input store, route every input surface through them, make the redirect from credit-memo → memo-inputs visible, make the rail link readiness-aware, and tuck legacy panels under `<AdvancedDisclosure>` so first-paint shows the lifted surfaces alone. No new tables. No lifecycle model changes. Single migration writes a one-time backfill from `deal_memo_overrides` into the new tables. The cumulative effect is that Samaritus and every other in-flight deal silently passes the gate, the banker never sees a silent URL flip, and the new architecture stops fighting the old one.

---

## PIV — pre-implementation verification (mandatory)

Run each of these and paste the output into the AAR. Do not skip.

### PIV-1. Confirm the redirect that drives friction #2 still exists

```bash
grep -n "redirect.*memo-inputs" src/app/\(app\)/deals/\[dealId\]/credit-memo/page.tsx
```

Expected: one line near the top of the file, inside a guard block that fires when `inputResult.package.readiness.ready === false`.

### PIV-2. Confirm `MemoCompletionWizard` writes to legacy `deal_memo_overrides`

```bash
grep -rn "credit-memo/overrides" src/components/creditMemo/MemoCompletionWizard.tsx
grep -rn "deal_memo_overrides" src/app/api/deals/\[dealId\]/credit-memo/overrides/route.ts
```

Expected: wizard POSTs to `/api/deals/{dealId}/credit-memo/overrides`; the route writes to `deal_memo_overrides`. Confirms the wizard is currently a trap (writes to legacy table that the gate ignores).

### PIV-3. Confirm `prefillMemoInputs` does not read `deal_memo_overrides`

```bash
grep -n "deal_memo_overrides" src/lib/creditMemo/inputs/prefillMemoInputs.ts
```

Expected: zero hits. Confirms the prefill engine is blind to banker-entered legacy overrides.

### PIV-4. Confirm `loadBankerOverrides` reads but `evaluateMemoInputReadiness` doesn't use overrides for gating

```bash
grep -n "banker_overrides" src/lib/creditMemo/inputs/evaluateMemoInputReadiness.ts
grep -n "loadBankerOverrides\|banker_overrides" src/lib/creditMemo/inputs/buildMemoInputPackage.ts
```

Expected: the build package loads overrides into `pkg.banker_overrides`; the readiness evaluator does not reference `banker_overrides` at all. Confirms overrides are dead weight in the package.

### PIV-5. Confirm `CreditMemoPanel` link is hardcoded, not readiness-aware

```bash
grep -n "/credit-memo\b" src/components/journey/stageViews/committee/CreditMemoPanel.tsx
```

Expected: a hardcoded `Link` with `href={\`/deals/${dealId}/credit-memo\`}` and `label="Open Memo"`, with no branching on `memoSummary.missing_keys.length`.

### PIV-6. Confirm the redundant routes are still live (not already redirected)

```bash
ls src/app/\(app\)/deals/\[dealId\]/committee/page.tsx
ls src/app/\(app\)/deals/\[dealId\]/underwrite-console/page.tsx 2>/dev/null
grep -l "redirect" src/app/\(app\)/deals/\[dealId\]/committee/page.tsx
```

Expected: `/committee` is a real renderer, not a redirect (it imports `CommitteeView`). `/underwriter` is already redirected per Phase 57C — confirm.

### PIV-7. Sanity-check the Samaritus state matches the spec's premise

Run via `the buddy supa mcp:execute_sql`:

```sql
SELECT
  (SELECT COUNT(*) FROM deal_borrower_story WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd') AS borrower_story_rows,
  (SELECT COUNT(*) FROM deal_management_profiles WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd') AS mgmt_rows,
  (SELECT COUNT(*) FROM deal_collateral_items WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd') AS coll_rows,
  (SELECT jsonb_object_keys(overrides) AS k FROM deal_memo_overrides WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd' LIMIT 1) AS sample_legacy_key;
```

Expected: borrower_story_rows = 0, mgmt_rows = 0, coll_rows ≥ 1, sample_legacy_key returns one of `business_description`, `revenue_mix`, `seasonality`, `principal_bio_*`. If any expectation fails, **stop and report** — the underlying state has shifted and this spec needs a refresh.

---

## Scope

### In scope (this spec)

1. **Backfill helper.** A pure function `migrateLegacyOverridesToCanonical({ dealId, bankId, overrides })` that converts a `deal_memo_overrides.overrides` JSON object into one `deal_borrower_story` row and N `deal_management_profiles` rows (one per `principal_bio_*` key, joined with `ownership_entities.display_name` to derive `person_name`). Idempotent: skips writes if a borrower-story row already exists.

2. **Auto-migration on first read.** `buildMemoInputPackage` calls `migrateLegacyOverridesToCanonical` exactly once (gated by an "is the borrower_story empty AND legacy overrides present" check) before evaluating readiness.

3. **Prefill source expansion.** `prefillMemoInputs` reads `deal_memo_overrides` as a 7th source and projects its keys into `borrower_story.business_description`, `borrower_story.revenue_model` (from `revenue_mix`), `borrower_story.key_risks` (from `seasonality`), and `management_profiles[*].resume_summary` (from `principal_bio_*`). Source = `"banker_override_legacy"`, confidence = 0.85.

4. **MemoCompletionWizard rewires its writes.** Wizard POSTs to a new endpoint `/api/deals/[dealId]/memo-inputs/from-wizard` that maps the wizard's keys onto `deal_borrower_story` + `deal_management_profiles` columns and writes through `upsertBorrowerStory` / `upsertManagementProfile`. Legacy `deal_memo_overrides` table stays read-only; the wizard's POST to its own route is removed.

5. **Visible redirect copy.** Replace the silent `redirect()` in `/credit-memo/page.tsx` with a server-side render of a slim `<MemoInputsRedirectBanner />` that wraps the existing `<MemoInputsPage />` content for one render, then client-side navigates after 1.5s. Banker reads the banner ("Three quick inputs needed before this memo can finalize — completing them now"), understands what happened.

6. **Readiness-aware Open Memo link.** `CreditMemoPanel` accepts an `isReady` boolean derived from `memoSummary.missing_keys.length === 0`. When not ready: link reads "Complete Memo Inputs" → `/memo-inputs`. When ready: link reads "Open Memo" → `/credit-memo`. One click instead of four.

7. **Legacy-panel demotion in stage views.** In `DocumentsStageView` and `UnderwritingStageView`, the legacy `LeftColumn` / `CenterColumn` / `ReadinessPanel` block (currently a sibling of the lifted summary surfaces) moves *inside* the existing `<AdvancedDisclosure>`. First paint shows summary surfaces only; clicking "Advanced" reveals the deep editors. No deletion — they're still mounted, just collapsed by default.

8. **Route audit + 308 redirects.** `/committee` (real renderer separate from `/committee-studio`) gets converted to a `redirect()` to `/committee-studio`. Confirm `/underwriter` and `/underwrite-console` are already redirected (Phase 57C). No other route deletions in this spec — the 41-route long tail is a future audit.

### Out of scope (for separate specs)

- Voice / transcript pipeline write targets (currently `canonical_memo_narratives`) — separate consolidation, not part of this pass.
- Builder Story step write target (currently `deal_builder_sections`) — separate consolidation.
- Deletion of `deal_memo_overrides` — keep table, mark code paths as legacy in a follow-up.
- Any new lifecycle stages or blocker codes.
- Any UI redesign of the memo-inputs forms themselves — they're fine, just need data flowing into them.

---

## Tests

### Unit (pure, node:test)

```
src/lib/creditMemo/inputs/__tests__/migrateLegacyOverrides.test.ts
```

- Empty overrides → returns 0 borrower-story writes, 0 mgmt writes
- Overrides with business_description + revenue_mix → 1 borrower-story row with both fields
- Overrides with two `principal_bio_<uuid>` keys + matching ownership_entities → 2 mgmt rows with correct person_name from ownership_entities.display_name
- Overrides with `principal_bio_<uuid>` but no matching ownership entity → mgmt row with person_name = "Unknown" (don't drop the bio)
- Idempotency: when borrower_story row already exists for the deal, returns "skipped" without writing

```
src/lib/creditMemo/inputs/__tests__/prefillMemoInputs.legacyOverrides.test.ts
```

- When `deal_memo_overrides.overrides.business_description` is present and `deal.description` is null and research is null → suggested `business_description.source === "banker_override_legacy"` with the overrides text
- When research has `industry_overview` AND overrides has `business_description` → research wins (existing precedence preserved)
- When overrides has `principal_bio_<uuid>` matching an ownership entity → suggestion appears in `management_profiles[<idx>].resume_summary` with that text

### Integration (e2e against Samaritus, dry-run)

```
src/lib/creditMemo/inputs/__tests__/buildMemoInputPackage.samaritus.test.ts
```

Uses Supabase test client. Pre-condition: snapshot Samaritus rows. Post-condition: assert `evaluateMemoInputReadiness` returns `ready: true` after the auto-migration fires. **This test is the proof the spec works** — if it passes, Samaritus will pass the gate after the deploy lands.

### Visual / route

```
src/app/(app)/deals/[dealId]/credit-memo/__tests__/redirect-banner.test.tsx
```

Mock `buildMemoInputPackage` to return `readiness.ready === false`. Render the page. Assert that the response contains the redirect banner element (by `data-testid="memo-inputs-redirect-banner"`) AND the memo-inputs surface — not just a 307. The banner copy must include the count of missing inputs.

```
src/components/journey/stageViews/committee/__tests__/CreditMemoPanel.readiness.test.tsx
```

Render with `memoSummary.missing_keys = []` → assert primary link reads "Open Memo" and points to `/credit-memo`. Render with `missing_keys = ["business_description"]` → assert primary link reads "Complete Memo Inputs" and points to `/memo-inputs`.

### Regression

`pnpm test` clean. No SPEC-01 / SPEC-04 / SPEC-06 tests broken.

---

## V-N verification checklist (each item must be checked off in AAR)

V-1. ☐ All 5 PIV grep / SQL outputs pasted into AAR; if any pre-condition failed, work stopped and Matt was pinged.
V-2. ☐ `migrateLegacyOverridesToCanonical` shipped + 5 unit tests passing.
V-3. ☐ `buildMemoInputPackage` invokes the migration exactly once, gated correctly. Verified via integration test.
V-4. ☐ `prefillMemoInputs` projects `deal_memo_overrides` into 4 prefill fields. 3 unit tests passing.
V-5. ☐ `MemoCompletionWizard` POSTs to `/api/deals/[dealId]/memo-inputs/from-wizard`. Old route `/api/deals/[dealId]/credit-memo/overrides` POST is preserved as a no-op deprecation shim returning `{ ok: true, deprecated: true }` for one deploy cycle (do not delete yet).
V-6. ☐ `/credit-memo/page.tsx` no longer calls `redirect()` on gate failure — it renders `<MemoInputsRedirectBanner />` + the memo-inputs surface inline. Visual confirmation via screenshot.
V-7. ☐ `CreditMemoPanel` link is conditional on `memoSummary.missing_keys.length`. Two tests passing.
V-8. ☐ `DocumentsStageView` and `UnderwritingStageView`: legacy column block now sits under `<AdvancedDisclosure>`, not as siblings. First paint of `/cockpit` for Samaritus shows lifted surfaces only — confirmed via screenshot.
V-9. ☐ `/committee/page.tsx` is now `redirect(`/deals/${dealId}/committee-studio`)`. Confirmed via grep + browser hit.
V-10. ☐ Run the integration test against Samaritus (`0279ed32`) and assert the post-condition: `deal_borrower_story` has 1 row, `deal_management_profiles` has ≥ 1 row, `evaluateMemoInputReadiness` returns `ready: true`, paste the resulting readiness JSON into AAR.
V-11. ☐ `pnpm tsc --noEmit` clean.
V-12. ☐ `pnpm test` clean.

---

## Files affected

### New files

| Path | Purpose |
|------|---------|
| `src/lib/creditMemo/inputs/migrateLegacyOverridesToCanonical.ts` | Pure migration helper |
| `src/lib/creditMemo/inputs/__tests__/migrateLegacyOverrides.test.ts` | 5 unit tests |
| `src/lib/creditMemo/inputs/__tests__/prefillMemoInputs.legacyOverrides.test.ts` | 3 unit tests |
| `src/lib/creditMemo/inputs/__tests__/buildMemoInputPackage.samaritus.test.ts` | 1 integration test |
| `src/app/api/deals/[dealId]/memo-inputs/from-wizard/route.ts` | New canonical write endpoint for wizard |
| `src/components/creditMemo/MemoInputsRedirectBanner.tsx` | Inline banner replacing silent redirect |
| `src/app/(app)/deals/[dealId]/credit-memo/__tests__/redirect-banner.test.tsx` | Visual test |
| `src/components/journey/stageViews/committee/__tests__/CreditMemoPanel.readiness.test.tsx` | Link conditional test |

### Modified files

| Path | Change | Risk |
|------|--------|------|
| `src/lib/creditMemo/inputs/buildMemoInputPackage.ts` | Insert migration call before readiness eval | Low — gated, idempotent |
| `src/lib/creditMemo/inputs/prefillMemoInputs.ts` | Add `loadBankerOverrides` source + 4 projections | Low — additive |
| `src/components/creditMemo/MemoCompletionWizard.tsx` | Change POST URL to from-wizard endpoint | Low — endpoint shim preserves backwards |
| `src/app/api/deals/[dealId]/credit-memo/overrides/route.ts` | Convert POST to deprecation no-op shim returning 200 | Low — deprecation only |
| `src/app/(app)/deals/[dealId]/credit-memo/page.tsx` | Replace redirect() with banner + inline render | Med — UX-visible |
| `src/components/journey/stageViews/committee/CreditMemoPanel.tsx` | Conditional link based on readiness | Low |
| `src/components/journey/stageViews/DocumentsStageView.tsx` | Move legacy columns under AdvancedDisclosure | Med — visual |
| `src/components/journey/stageViews/UnderwritingStageView.tsx` | Move legacy columns under AdvancedDisclosure | Med — visual |
| `src/app/(app)/deals/[dealId]/committee/page.tsx` | Convert to redirect | Low |

No DB migrations. No new tables. No lifecycle model changes. No changes to `evaluateMemoInputReadiness` (the contract stays put — we just feed it the right data).

---

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Backfill writes wrong data into `deal_borrower_story` for deals with malformed overrides | Migration is gated on borrower_story being empty AND on overrides having at least `business_description` set — if either fails, skip write |
| 2 | Removing the silent redirect breaks bookmarks that landed on `/credit-memo` and expected the redirect to teleport them | The new behavior keeps them on `/credit-memo` and renders the inputs inline; bookmarks still work, just nicer |
| 3 | Wizard endpoint shim accidentally still writes to legacy table (forgotten line) | The shim must `return NextResponse.json({ ok: true, deprecated: true, message: "Use /memo-inputs/from-wizard" })` and that's it. PR reviewer must visually confirm zero DB calls in the shim |
| 4 | `prefillMemoInputs` legacy projection over-suggests stale data and confuses the banker | Confidence = 0.85 (lower than research at 0.95), and source label `"banker_override_legacy"` is shown in UI so banker can see "this came from your earlier wizard entry" |
| 5 | AdvancedDisclosure default-collapsed hides controls a banker reflexively expects to find | The collapsed header shows item counts (e.g., "Advanced — 13 checklist items, 3 reviews pending") so the banker knows the depth is there. Add a `data-testid="advanced-disclosure-trigger"` for click-test discoverability |
| 6 | `/committee` redirect breaks an in-flight test/QA flow | Search the repo for hardcoded `/deals/*/committee` links before shipping; add a console.warn in the redirect for one deploy so we see if anything legitimately hits it |
| 7 | Samaritus integration test mutates production state and other tests fail | Test must use a snapshot/restore pattern — wrap in a transaction or use a fresh test deal cloned from Samaritus, never write to `0279ed32` directly |

---

## Hand-off commit message

```
spec(banker-road): SPEC-13 banker road consolidation — fix 5 friction points found in e2e review

Fixes:
1. Backfill deal_memo_overrides → deal_borrower_story / deal_management_profiles (auto, idempotent)
2. Prefill engine reads legacy overrides as a 7th source (confidence 0.85)
3. MemoCompletionWizard writes to canonical tables, not legacy overrides table
4. /credit-memo no longer silently redirects to /memo-inputs — renders inline with banner
5. CreditMemoPanel link is readiness-aware (Open Memo vs Complete Memo Inputs)
6. Legacy LeftColumn/CenterColumn/ReadinessPanel demoted under AdvancedDisclosure
7. /committee → 308 redirect to /committee-studio

Net effect: Samaritus passes the gate without re-entry. Banker road is one click fewer per stage. Five surfaces collapse to one canonical write target. No DB migrations, no lifecycle changes.
```

---

## Addendum — non-obvious rules

1. **Do not touch `evaluateMemoInputReadiness.ts`.** The contract is right; the data feeding it is wrong. Changing the evaluator would invalidate the SPEC-04 readiness contract that the submission gate depends on.
2. **Do not delete `deal_memo_overrides`.** Many other code paths (audit, replay, backfill scripts) read from it. This spec marks it read-only via the wizard rewire; deletion is a separate spec.
3. **The deprecation shim on `/api/.../credit-memo/overrides` is a one-deploy thing.** It exists so that a banker mid-flight with an open wizard tab doesn't get a 404. Add a TODO comment with a removal-after date 14 days out.
4. **Do not introduce a new lifecycle blocker.** The existing `missing_business_description`, `missing_management_profile`, `missing_collateral_*` blockers cover everything; we're just feeding them the right data.
5. **The `/credit-memo` inline render uses `<MemoInputsPage />` content, not a server-side `redirect()`.** This means the page loses its current `maxDuration = 30` benefit — set explicitly to `maxDuration = 60` since both packages now run.
6. **Visual confirmation required for V-6 and V-8.** Include screenshots in the AAR markdown via raw image links. Browser session must be the dev login on Samaritus.
7. **Do not change the route audit beyond `/committee`.** The 41-route long tail is real but tackling it here scope-creeps. One redirect, one deploy, one test.
8. **Sentence case in the banner copy.** "Three quick inputs needed before this memo can finalize" — not "Three Quick Inputs Needed."
9. **The from-wizard endpoint is bank-scoped via `requireDealAccess`.** Must enforce tenant isolation per Buddy's multi-tenant rule (memory: foundational constraint).
10. **AAR must include the readiness JSON for Samaritus pre- and post-deploy** so we have ledger evidence the gate state actually flipped.

---

End of SPEC-13.
