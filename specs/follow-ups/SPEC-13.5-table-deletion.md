## SPEC-13.5 PR-D — Drop legacy `deal_memo_overrides` table

**Status:** Queued, blocked by 14-day observation window AND by closure of SPEC-13.7 + SPEC-13.8
**Earliest execution date:** `[PR-C deploy date + 14 days]` *(fill in when PR-C deploys)*

## Pre-conditions

1. **`spec_13_5_legacy_writes_observation` view shows 14 consecutive days of zero writes.** Created by PR-C Commit 2 migration `20260614000000_spec_13_5_observation_view.sql`. Daily query:
   ```sql
   SELECT * FROM spec_13_5_legacy_writes_observation;
   ```
   If any day in the trailing 14 shows `legacy_writes > 0`, restart the window and investigate the source (CI guard should have caught it; if it didn't, fix the guard pattern).

2. **CI guard from PR-C has been merged for 14 days with no exceptions.** The guard script `scripts/check-no-legacy-overrides-writes.sh` must remain green on every PR for the full 14-day window. Any allowlist additions during the window restart the clock.

3. **All 4 deals identified in SPEC-13.5 PIV-2 have canonical-store rows confirmed.** (3 with structured content; Test Pack 4-23-26 #1 documented as the structured-fields-empty case per amended A-4 item 6.)
   ```sql
   SELECT
     d.id,
     d.display_name,
     (SELECT COUNT(*) FROM deal_borrower_story WHERE deal_id = d.id) AS bs_rows,
     (SELECT COUNT(*) FROM deal_management_profiles WHERE deal_id = d.id) AS mp_rows
   FROM deals d
   WHERE d.id IN (
     '80fe6f7a-5c68-4f02-8bcf-933f246a9fc5',
     '0d31ebf3-485d-414e-a8ac-9b0e79884944',
     'e505cd1c-86b4-4d73-88e3-bc71ef342d94',
     '0279ed32-c25c-4919-b231-5790050331dd'
   );
   ```

4. **SPEC-13.7 closed.** `builderCanonicalWrite.ts:writeStoryCanonical` and `borrower/update/route.ts` have migrated off `deal_memo_overrides` and been removed from the CI guard's allowlist.

5. **SPEC-13.8 closed.** `memo-overrides/route.ts` cockpit endpoint has either migrated to canonical OR been deprecated entirely; allowlist entry removed.

   *(Pre-conditions 4 and 5 are critical: dropping the table while any allowlisted writer remains in production will cause those writers to error. The 14-day observation window does NOT itself cover this — the window measures whether writes ARE happening, not whether the writers EXIST.)*

## Action

1. **Migration:** new file `supabase/migrations/[timestamp]_spec_13_5_drop_deal_memo_overrides.sql`:
   ```sql
   DROP TABLE deal_memo_overrides;
   DROP VIEW spec_13_5_legacy_writes_observation;
   ```
   *Schedule for off-hours. Coordinate with deploy window.*

2. **Code cleanup:**
   - Remove the deprecation shim endpoint at `src/app/api/deals/[dealId]/credit-memo/overrides/route.ts` entirely.
   - Remove all GET-side references in the codebase (the prefill paths in `prefillMemoInputs.ts`, `reconcileDealFacts.ts`, `buildCanonicalCreditMemo.ts`, `submitCreditMemoToUnderwriting.ts`, `builderPrefill.ts`, `recovery/*`).
   - Remove `scripts/check-no-legacy-overrides-writes.sh` (no longer needed once table is gone).
   - Remove the `SPEC-13.5 — no legacy deal_memo_overrides writes` step from `.github/workflows/ci.yml`.
   - Remove `SPEC-13.5 PR-C` reference from any V-N tracking.

3. **Update SPEC-13 follow-up ticket as resolved.** The original SPEC-13 banker road consolidation finally closes when the legacy table is gone.

## Out of scope of this PR
- The cleanup chain itself (SPEC-13.6 / 13.7 / 13.8 / 13.9). Each is a separate PR; this PR is the final closeout.
- Backup/archival of the legacy table contents. The 4 backfilled deals' content is already in canonical; nothing else needs preserving.
