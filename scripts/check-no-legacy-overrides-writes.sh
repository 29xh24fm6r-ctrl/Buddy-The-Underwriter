#!/usr/bin/env bash
# SPEC-13.5 PR-C C-1 — CI guard against new writes to deal_memo_overrides.
#
# Fails the build if any non-test code in `src/` (or the directory passed
# as $1) destructively touches deal_memo_overrides via a Supabase chain:
# `.from("deal_memo_overrides")` followed within ~20 lines by one of
# `.insert(`, `.update(`, `.upsert(`, `.delete(`.
#
# Reads (`.select(`) are unconditionally allowed — the deprecation shim's
# GET handler and several legacy prefill paths still need to read.
#
# Two known writers are explicitly allowlisted as documented tech debt
# (each paired with a follow-up spec covering migration). New entries
# require explicit justification in this file's comment block AND a
# paired follow-up spec; otherwise the guard blocks merge.
#
# Usage:
#   bash scripts/check-no-legacy-overrides-writes.sh             # scans `src`
#   bash scripts/check-no-legacy-overrides-writes.sh /tmp/dir    # scans a custom dir (used by tests)

set -euo pipefail

SCAN_DIR="${1:-src}"

# ── Allowlist ────────────────────────────────────────────────────────────
#
# Each entry is a path SUFFIX (relative to repo root) of a file known to
# write to deal_memo_overrides. Match is suffix-based so the script works
# correctly when invoked against a temp dir in tests.

ALLOWLIST=(
  # SPEC-FOUNDATION-V1 PR1 — the migration helper's rekey operation.
  # When legacy deal_memo_overrides are migrated to canonical
  # deal_management_profiles, the migration assigns new UUIDs. The
  # principal_bio_{legacyId} override keys must be rewritten to
  # principal_bio_{canonicalId} in the same transaction so the readiness
  # contract can find the bio under the correct key. This is a migration
  # write (not a new feature write) and is the only code path that
  # updates deal_memo_overrides.overrides JSONB keys.
  # Spec: specs/foundation-v1/SPEC-FOUNDATION-V1-PR1-orphaned-principal-bio.md
  "src/lib/creditMemo/inputs/migrateLegacyOverridesAsync.ts"

  # SPEC-13.5 explicit out-of-scope per spec addendum (Scope > Out of
  # scope > "Builder Story step write target. Separate consolidation.").
  # The Builder Story step is on the borrower-side flow and writes a
  # partially-overlapping field set (use_of_proceeds,
  # principal_background, competitive_position, key_weaknesses,
  # key_strengths, committee_notes). Migrating it to canonical is its
  # own spec arc (the borrower flow, not the banker flow).
  # File: specs/follow-ups/SPEC-13.7-builder-story-canonical-migration.md
  "src/lib/builder/builderCanonicalWrite.ts"

  # SPEC-13.5 PR-C discovery — cockpit-side endpoint not audited by the
  # original SPEC-13.5 PIVs. Different auth (requireDealCockpitAccess),
  # different consumer (likely an underwriter cockpit surface),
  # different write shape (single-key patches with permitted-key gate
  # via isPermittedOverrideKey). Likely written by some cockpit UI
  # surface PIV-6's grep didn't find — investigation needed before
  # deletion.
  # File: specs/follow-ups/SPEC-13.8-cockpit-memo-overrides-deprecation.md
  "src/app/api/deals/[dealId]/memo-overrides/route.ts"

  # SPEC-13.5 PR-C discovery #2 — borrower-flow journey update endpoint.
  # Same arc as src/lib/builder/builderCanonicalWrite.ts: borrower-side
  # flow writing the same overlapping field set (banker_summary,
  # website, dba, business_description, revenue_mix, seasonality,
  # collateral_*, competitive_advantages, vision, principal_bio_*) via
  # read-modify-upsert. Folded into SPEC-13.7's migration scope
  # alongside builderCanonicalWrite.
  # File: specs/follow-ups/SPEC-13.7-builder-story-canonical-migration.md
  "src/app/api/deals/[dealId]/borrower/update/route.ts"
)

is_allowlisted() {
  local file="$1"
  local entry
  for entry in "${ALLOWLIST[@]}"; do
    case "$file" in
      *"/$entry") return 0 ;;
      "$entry") return 0 ;;
    esac
  done
  return 1
}

# ── Scan ─────────────────────────────────────────────────────────────────

if [ ! -d "$SCAN_DIR" ]; then
  # Empty dir or missing dir → nothing to scan, exit 0.
  echo "SPEC-13.5 guard: scan dir does not exist ($SCAN_DIR), nothing to check."
  exit 0
fi

FILES=$(find "$SCAN_DIR" -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -path '*/__tests__/*' \
  ! -path '*/__invariants__/*' \
  ! -name '*.test.ts' \
  ! -name '*.test.tsx' \
  2>/dev/null || true)

violations=0
allowlisted_hits=0

if [ -n "$FILES" ]; then
  while IFS= read -r file; do
    [ -z "$file" ] && continue

    matches=$(grep -nE '\.from\(["'"'"']deal_memo_overrides["'"'"']\)' "$file" 2>/dev/null || true)
    [ -z "$matches" ] && continue

    if is_allowlisted "$file"; then
      while IFS=: read -r line_no _; do
        [ -z "$line_no" ] && continue
        echo "ℹ️  allowlisted: $file:$line_no — see paired follow-up spec"
        allowlisted_hits=$((allowlisted_hits + 1))
      done <<< "$matches"
      continue
    fi

    # Non-allowlisted file: for each .from(...) match, check the next 20
    # lines (inclusive) for a destructive method.
    while IFS=: read -r line_no _; do
      [ -z "$line_no" ] && continue
      end_line=$((line_no + 20))
      chunk=$(sed -n "${line_no},${end_line}p" "$file")
      if echo "$chunk" | grep -qE '\.(insert|update|upsert|delete)\('; then
        echo "❌ $file:$line_no — destructive write to deal_memo_overrides"
        echo "$chunk" | head -8 | sed 's/^/    /'
        echo ""
        violations=$((violations + 1))
      fi
    done <<< "$matches"
  done <<< "$FILES"
fi

# ── Result ───────────────────────────────────────────────────────────────

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "SPEC-13.5 guard: $violations violation(s) found."
  echo ""
  echo "If you legitimately need to write to deal_memo_overrides, see"
  echo "specs/banker-flow-v1/SPEC-13.5-complete-cutover.md and the allowlist"
  echo "in this script. Adding a new allowlist entry requires a paired"
  echo "follow-up spec referencing the migration plan."
  exit 1
fi

if [ "$allowlisted_hits" -gt 0 ]; then
  echo ""
  echo "SPEC-13.5 guard: 0 violations ($allowlisted_hits allowlisted hit(s) — see paired follow-up specs)."
else
  echo "SPEC-13.5 guard: 0 violations."
fi
exit 0
