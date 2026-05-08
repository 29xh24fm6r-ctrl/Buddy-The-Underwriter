# SPEC-FOUNDATION-V1 PR1 follow-up — OmniCare Review duplicate "Matt Hunt" canonical profiles

Filed during SPEC-FOUNDATION-V1 PR1 A-3 backfill execution (2026-05-08). Two orphaned `principal_bio_{legacyId}` keys on deal `0d31ebf3-485d-414e-a8ac-9b0e79884944` (OmniCare Review) could not be auto-rekeyed because the deal has two canonical `deal_management_profiles` rows with the same `person_name = "Matt Hunt"`, making single-match resolution by name impossible. The script's safety gate (matches.length !== 1 → flag, do not rewrite) preserved both keys as-is. Stage is `collecting`; no submission pressure; deferred per Matt's call.

## Detected
SPEC-FOUNDATION-V1 PR1 A-3 backfill execute run (2026-05-08, audit event `34b6c445-...` on Samaritus; OmniCare Review deal had no audit event written because `proposal.noOp = true` for the duplicate-name path).

## Expected
Each orphaned `principal_bio_{legacyId}` key on a SPEC-13.5 backfilled deal resolves to exactly one canonical profile via `ownership_entities.display_name` → `deal_management_profiles.person_name`, allowing the script to auto-rekey.

## Actual
Two orphaned keys both resolve to `person_name = "Matt Hunt"`. There are two `deal_management_profiles` rows for this deal with `person_name = "Matt Hunt"`. `matches.length === 2` → flagged for manual review, both keys preserved unchanged.

## Hypotheses for the duplicate
1. Two distinct individuals named Matt Hunt (e.g., father/son, partners with same name) — legitimate duplicate that needs disambiguation by middle initial, suffix, or DOB.
2. Data-entry duplication at SPEC-13.5 PR-A migration time — same person upserted twice under different `ownership_entities.id` parents.
3. Migration artifact — the legacy override structure had two `principal_bio_{legacyId}` entries pointing at distinct legacy ownership rows that both happened to carry the same display name.

Hypothesis 2 is the most likely given the SPEC-13.5 known-issue history; hypothesis 1 cannot be ruled out without inspecting the bios.

## Investigation needed
1. Query both `deal_management_profiles` rows on this deal — capture `id`, `person_name`, `ownership_pct`, `title`, `created_at`, any other distinguishing fields.
2. Query both orphaned keys' bio payloads in `deal_memo_overrides.overrides` — read the bio text content side-by-side. Look for distinguishing details (different employment history, different DOB, different role, etc.).
3. Cross-reference with `ownership_entities` for the deal — are there two distinct rows with `display_name = "Matt Hunt"`? What are the `ownership_pct` and other fields on each?
4. If hypothesis 2 (true duplicate same person): merge the two `deal_management_profiles` rows, point both override keys at the surviving canonical `id`, delete the dropped row.
5. If hypothesis 1 (two distinct people): disambiguate `person_name` on both canonical profiles (e.g., "Matt Hunt Sr." / "Matt Hunt Jr.", or append middle initial). Update `ownership_entities.display_name` to match. Then re-run the PR1 backfill — disambiguated names will produce unique single matches.

## Impact
None until OmniCare Review approaches submission. Both orphaned keys are preserved verbatim, so no bio data is lost. The `management_bio` readiness gate on this deal will remain blocked by these two keys (and possibly other gates), but the deal stage is `collecting` so this is not on the critical path.

## Resolution
Defer until either (a) OmniCare Review advances toward submission and the gate becomes blocking, or (b) we batch-investigate all SPEC-13.5 migration artifacts as part of a broader data-quality sweep. Whichever comes first.

## Related
- SPEC-FOUNDATION-V1 PR1 (PR #405, merged 2026-05-08, commit `96c744c9`)
- SPEC-13.5 PR-A migration (the originating cause)
- Audit event for Samaritus successful rekey: `deal_events.id = 34b6c445-5349-4b8d-800b-fcaaa68bbaa3`
