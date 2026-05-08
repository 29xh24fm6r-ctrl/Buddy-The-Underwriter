# SPEC-FOUNDATION-V1 PR1 — Fix Orphaned `principal_bio` Overrides

**Status:** Ready for Claude Code
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** opens against `feat/foundation-v1-pr1-orphaned-principal-bio`
**Depends on:** SPEC-FOUNDATION-V1 parent committed
**Blocks:** Closes the `management_bio` blocker for Samaritus and the 3 other SPEC-13.5 backfilled deals

## Problem in one paragraph

`evaluateMemoReadinessContract` in `src/lib/creditMemo/submission/evaluateMemoReadinessContract.ts` checks `management_bio` by iterating `memo.management_qualifications.principals` (which sources from canonical `deal_management_profiles`) and looking for `overrides[`principal_bio_${pid}`] ≥ 20 chars`. For Samaritus, `deal_memo_overrides.overrides` contains `principal_bio_394162a1-0d9a-4c62-bff2-c32240efaa4b` (84 chars, valid content) but `deal_management_profiles` has principal id `291dc943-86c8-477f-b455-f2febfeb092d` (different UUID, same person — Michael Newmark). The override is keyed under the old (legacy) principal id from before SPEC-13.5 PR-A backfilled the canonical store with new UUIDs. The contract finds no matching key and reports `management_bio: false`. **The bio data exists and is valid. The keying is orphaned.**

## Solution in one paragraph

Update `migrateLegacyOverridesToCanonical` (in `src/lib/creditMemo/inputs/migrateLegacyOverridesToCanonical.ts`) to maintain an internal `legacyPrincipalId → canonicalPrincipalId` mapping built during the management profile migration, then rewrite all `principal_bio_{legacyId}` override keys in `deal_memo_overrides.overrides` to `principal_bio_{canonicalId}` in a single transaction with the management profile insert. For the 4 already-migrated deals, ship a one-shot backfill script (`scripts/foundation-pr1-rekey-principal-bios.ts`) that walks the override JSONB, identifies orphaned `principal_bio_{uuid}` keys, attempts to match by person_name to canonical profiles, and rewrites under the canonical UUID. Add a CI guard at the boundary: any override key matching `principal_bio_{uuid}` MUST reference a uuid that exists in `deal_management_profiles` for that deal.

## PIV — pre-implementation verification

### PIV-1. Confirm the orphan pattern exists for all 4 backfilled deals

```sql
WITH deals AS (
  SELECT unnest(ARRAY[
    '0279ed32-c25c-4919-b231-5790050331dd'::uuid,  -- Samaritus
    '80fe6f7a-5c68-4f02-8bcf-933f246a9fc5'::uuid,  -- OmniCare May 1
    '0d31ebf3-485d-414e-a8ac-9b0e79884944'::uuid,  -- OmniCare Review
    'e505cd1c-86b4-4d73-88e3-bc71ef342d94'::uuid   -- Test Pack #1
  ]) AS deal_id
),
override_principal_keys AS (
  SELECT 
    o.deal_id,
    jsonb_object_keys(o.overrides) AS k
  FROM deal_memo_overrides o
  JOIN deals d ON d.deal_id = o.deal_id
),
canonical_principal_ids AS (
  SELECT 
    deal_id, 
    id::text AS canonical_id, 
    person_name
  FROM deal_management_profiles
  WHERE deal_id IN (SELECT deal_id FROM deals)
)
SELECT 
  o.deal_id,
  o.k AS override_key,
  REPLACE(o.k, 'principal_bio_', '') AS extracted_uuid_in_key,
  EXISTS(
    SELECT 1 FROM canonical_principal_ids c 
    WHERE c.deal_id = o.deal_id 
      AND c.canonical_id = REPLACE(o.k, 'principal_bio_', '')
  ) AS uuid_exists_in_canonical
FROM override_principal_keys o
WHERE o.k LIKE 'principal_bio_%'
ORDER BY o.deal_id;
```

**Expected:** every row has `uuid_exists_in_canonical = false` (or close to it), confirming the orphan pattern is universal across the 4 backfilled deals.

### PIV-2. Confirm the legacy-to-canonical migration helper does not currently rekey overrides

```bash
grep -n "principal_bio\|principalId\|rewriteOverride" \
  src/lib/creditMemo/inputs/migrateLegacyOverridesToCanonical.ts
```

**Expected:** no hits on rewriting logic. The migration helper writes to `deal_management_profiles` but does not update `deal_memo_overrides`.

### PIV-3. Confirm `migrateLegacyOverridesAsync.ts` is the wrapper used by `buildMemoInputPackage`

```bash
grep -rn "migrateLegacyOverridesToCanonical\|migrateLegacyOverridesAsync" \
  src/lib/creditMemo/inputs/
```

**Expected:** confirms `buildMemoInputPackage.ts` calls through `migrateLegacyOverridesAsync` which calls `migrateLegacyOverridesToCanonical`.

### PIV-4. Confirm no CI guard currently exists for override-to-profile id consistency

```bash
grep -rn "principal_bio.*management_profiles\|orphan.*principal\|management_profiles.*override" \
  src/lib/creditMemo/__tests__/ \
  src/lib/deals/readiness/__tests__/
```

**Expected:** zero hits. PR1 ships the first such guard.

### PIV-5. Confirm no other codepath writes `principal_bio_{uuid}` keys

```bash
grep -rn "principal_bio_" src/ --include="*.ts" --include="*.tsx"
```

**Expected:** the only writers should be `migrateLegacyOverridesToCanonical` (legacy migration), the BankerReviewPanel (banker UI write), and reads in `evaluateMemoReadinessContract`. Confirms the keying contract is well-scoped.

## Scope

### In scope (PR1)

#### A-1. Update `migrateLegacyOverridesToCanonical` to rewrite override keys

In `src/lib/creditMemo/inputs/migrateLegacyOverridesToCanonical.ts`:

- During management profile creation, build a Map<legacyPrincipalId, canonicalPrincipalId>.
- After all management profiles are inserted, walk the input `overrides` JSONB and rewrite any `principal_bio_{legacyId}` keys to `principal_bio_{canonicalId}` where the mapping has an entry.
- For orphaned principal_bio keys (legacyId has no mapping), preserve the key but flag in audit event for human review.
- Write the rewritten overrides back to `deal_memo_overrides.overrides` in the same transaction as the management profile insert.

The migration's return type expands to include `{ overrideKeysRewritten: number, orphanedKeys: string[] }` for telemetry.

#### A-2. Update audit event to capture rewriting outcome

Extend the `memo_input.legacy_migration` event payload (already written by `buildMemoInputPackage` per SPEC-13.5 PR-A) to include:

```ts
{
  // existing fields preserved
  override_keys_rewritten: number;     // count of principal_bio keys rekeyed
  orphaned_override_keys: string[];    // keys that couldn't be mapped (manual review needed)
}
```

#### A-3. One-shot backfill script for the 4 already-migrated deals

Create `scripts/foundation-pr1-rekey-principal-bios.ts`:

- Identifies all deals with `deal_memo_overrides` rows containing `principal_bio_{uuid}` keys where the uuid does NOT exist in `deal_management_profiles` for that deal.
- For each orphan, attempts to match by `person_name` (the bio is for "Michael Newmark" and there's exactly one Michael Newmark profile in the canonical store → automatic rekey). If no exact match or multiple matches, flag for manual review.
- Writes the rewritten overrides back via UPDATE on `deal_memo_overrides`.
- Emits one `memo_input.legacy_migration_backfill` audit event per deal with full before/after key map.
- Idempotent: re-running on already-rekeyed deals is a no-op.
- Dry-run mode: pass `--dry-run` to print proposed changes without writing.

Run sequence:
1. `pnpm tsx scripts/foundation-pr1-rekey-principal-bios.ts --dry-run` — paste output for review
2. After approval: `pnpm tsx scripts/foundation-pr1-rekey-principal-bios.ts --execute`
3. Verify by re-running PIV-1 — `uuid_exists_in_canonical` should be `true` for all rows

#### A-4. CI guard preventing future regression

Create `src/lib/creditMemo/__tests__/principalBioOverrideKeyConsistency.test.ts`:

The guard reads source files and asserts:

- `migrateLegacyOverridesToCanonical.ts` source contains the substring `legacyPrincipalId` and the substring `principal_bio_` (proving the rekey logic is present).
- The migration's return type signature contains `overrideKeysRewritten` (proving telemetry is in place).

Plus a runtime guard test that constructs a synthetic legacy override + canonical profile mismatch and asserts the helper produces consistent output. Mock-based, doesn't require Supabase.

#### A-5. Database-level consistency check (optional, deferred to PR4 if time pressure)

Create a Supabase migration that adds a CHECK constraint or trigger ensuring orphaned `principal_bio_{uuid}` keys cannot accumulate in `deal_memo_overrides`. Can be deferred to PR4 — the CI guard + migration update are sufficient for PR1.

### Out of scope (explicit)

- Changing `evaluateMemoReadinessContract` — the readiness gate is correct as written; the data was wrong.
- Changing the BankerReviewPanel UI write path — it writes correctly under the canonical id (sourced from canonical store).
- Other override-key naming patterns (e.g., `tabs_viewed`, `revenue_mix`) — those don't reference UUIDs and aren't affected.
- The other 3 issues in SPEC-FOUNDATION-V1 (collateral, T12, cash flow aggregator) — separate PRs.

## V-N verification checklist

- V-1. ☐ All 5 PIV outputs pasted into AAR.
- V-2. ☐ A-1: `migrateLegacyOverridesToCanonical` rewrites `principal_bio_{legacyId}` → `principal_bio_{canonicalId}` during migration.
- V-3. ☐ A-2: `memo_input.legacy_migration` audit event includes `override_keys_rewritten` + `orphaned_override_keys`.
- V-4. ☐ A-3: Backfill script run in dry-run mode, output reviewed, then executed against the 4 backfilled deals. PIV-1 re-run shows `uuid_exists_in_canonical = true` for all rows.
- V-5. ☐ A-4: CI guard tests passing.
- V-6. ☐ tsc clean.
- V-7. ☐ pnpm test:unit shows expected new test count, all green (1 deliberate-red from `pipelineRecompute` remains).
- V-8. ☐ Re-evaluate `evaluateMemoReadinessContract` against Samaritus's current data: `management_bio` blocker now `false` (gate clears).

## Files affected

| Path | Change | Risk |
|------|--------|------|
| `src/lib/creditMemo/inputs/migrateLegacyOverridesToCanonical.ts` | Add rekey logic + telemetry | Low |
| `scripts/foundation-pr1-rekey-principal-bios.ts` | New | Low (idempotent + dry-run) |
| `src/lib/creditMemo/__tests__/principalBioOverrideKeyConsistency.test.ts` | New | Low |

No migrations. No new tables.

## Risk register

1. **Backfill script renames a key but the canonical store doesn't actually have the matching person.** Mitigated by exact-name match requirement; if no match or multiple matches, script flags for manual review (does NOT auto-rekey).
2. **Race between backfill script and live banker UI write.** Mitigated by running script during low-traffic window; the script's UPDATE is atomic per deal.
3. **Rekey breaks BankerReviewPanel renders for in-progress sessions.** BankerReviewPanel reads from canonical management profiles to populate the UI; it would always have used the canonical UUID for new bio writes. Risk: if a banker has the panel OPEN at rekey time and the panel-side state cached the legacy UUID, their next write could use the legacy UUID. Mitigation: panel refresh on next page load picks up the canonical UUID. Acceptable.
4. **Person name collisions across the 4 deals.** Confirmed not an issue: each deal has ≤ 2 management profiles and names don't collide cross-deal. Script scopes match by `(deal_id, person_name)`.

## Hand-off commit message (for the implementation PR)

```
feat(foundation): rekey orphaned principal_bio overrides (SPEC-FOUNDATION-V1 PR1)

SPEC-13.5 PR-A migrated legacy deal_memo_overrides into canonical
deal_management_profiles but assigned new UUIDs while preserving
override keys keyed by old UUIDs. The principal_bio_{oldId} keys
point to principals that don't exist in the canonical store anymore,
so the management_bio submission gate fails even when valid bio data
is present.

This PR fixes the migration to maintain a legacyPrincipalId →
canonicalPrincipalId map and rewrite override keys in the same
transaction as the management profile insert. Includes a one-shot
backfill script for the 4 already-migrated deals (Samaritus, OmniCare
May 1, OmniCare Review, Test Pack #1) and a CI guard at the boundary.

After merge + backfill execution, Samaritus's management_bio gate
clears and end-to-end submission becomes possible (subject to other
SPEC-FOUNDATION-V1 PRs for the remaining gates).
```
