# SPEC-13.8 — Cockpit `/memo-overrides` endpoint deprecation

**Status:** Stub — filed during SPEC-13.5 PR-C (2026-05-07)
**Blocks:** Cleanup of SPEC-13.5 CI guard allowlist (removal of this entry)
**Related:** SPEC-13.5 (banker-flow canonical cutover), SPEC-13.7 (borrower-flow canonical migration)

## Goal
Identify all consumers of `/api/deals/[dealId]/memo-overrides` (PATCH
+ GET), determine whether to migrate the consumers to canonical or
fully deprecate the endpoint. Removes the last cockpit-side legacy
writer so the day-15 PR-D table drop is unblocked.

## Current state
`src/app/api/deals/[dealId]/memo-overrides/route.ts` exposes a separate
writer endpoint distinct from `/credit-memo/overrides`:

- **Auth**: `requireDealCockpitAccess(dealId, COCKPIT_ROLES)` — cockpit
  surfaces only (likely an underwriter/committee view).
- **PATCH shape**: single-key patches `{ key, value }` — different from
  the wizard/BankerReviewPanel's bulk-overrides shape.
- **Permitted-key gate**: `isPermittedOverrideKey(key)` from
  `src/lib/creditMemo/overridePolicy.ts` — restricts to qualitative
  narrative keys only.
- **Audit event**: `emitMemoOverrideSaved` — already fires on every
  PATCH (success AND rejected).

Writes to `deal_memo_overrides` via read-modify-update or insert
(lines 46, 48). Read at lines 19, 43.

The endpoint was NOT discovered by SPEC-13.5's PIV-6 grep (which only
checked the wizard and BankerReviewPanel). Surfaced during SPEC-13.5
PR-C's pre-allowlist audit.

## Blast radius
Unknown — the consumer audit is the first task. Likely candidates:
- Underwriter cockpit qualitative-override panel
- Committee surface qualitative override path
- Some legacy admin tool

The consumer audit determines whether this endpoint:
- Has live UI traffic that must continue working (→ migrate to canonical)
- Is dead code / stale UI (→ remove + deprecate)
- Is a parallel cousin of the wizard's path (→ unify on the SPEC-13.5
  canonical write path)

## Unblocking conditions
1. Identify all UI surfaces and call sites that POST to
   `/api/deals/[dealId]/memo-overrides`. Use:
   - `grep -rn "/memo-overrides" src/ --include="*.ts" --include="*.tsx"`
     (excluding the route file itself)
   - Browser network log on cockpit pages
2. For each consumer, decide: migrate-to-canonical vs deprecate.
3. If migrate: rewire to POST `/memo-inputs` `{ kind: "from-wizard", overrides }`
   (the canonical path SPEC-13.5 PR-B established).
4. If deprecate: convert the PATCH to a no-op shim (mirror the
   `/credit-memo/overrides` POST shim from SPEC-13.5) AND emit
   `memo_input.deprecated_endpoint_hit` telemetry so stale clients
   surface.
5. Once all consumers cutover (verified via 7-day observation window of
   zero PATCH hits), remove the endpoint entirely.
6. Remove the entry from
   `scripts/check-no-legacy-overrides-writes.sh` allowlist.
7. Day-15 PR-D table drop becomes unblocked once SPEC-13.7 + SPEC-13.8
   complete.

## Out of scope
- Migrating `/credit-memo/overrides` consumers (already done in SPEC-13.5).
- The cockpit's other write paths (collateral, management, conflicts)
  that already route through the consolidated `/memo-inputs` dispatcher.
