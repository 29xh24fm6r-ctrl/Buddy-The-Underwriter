# Phase 68 — Surface Wiring Remediation ✅ COMPLETE

**Closed:** April 3, 2026
**Commits:** Phase 68 components + CommitteeView + guard (Claude Code) | ledger cleanup pushed manually by Matt

---

## What shipped

| File | Change |
|---|---|
| `src/components/deals/shared/OmegaAdvisoryBadge.tsx` | New — Omega confidence badge, stale-safe, green/amber/red, compact mode |
| `src/components/deals/shared/CanonicalStateBanner.tsx` | New — canonical action banner, blocked/complete/advance variants |
| `src/components/deals/shared/__tests__/OmegaAdvisoryBadge.test.ts` | New — 24 tests, node:test + node:assert |
| `scripts/guard-demo-data.sh` | New — CI guard, blocks build on Highland Capital / Project Atlas / Titan Equities |
| `src/app/(app)/deals/[dealId]/committee/CommitteeView.tsx` | Full rewrite — fetches `/state` API, renders canonical state cards + Omega badge + blockers, eliminates StitchSurface |
| `src/app/(app)/deals/[dealId]/underwrite/AnalystWorkbench.tsx` | Added compact OmegaAdvisoryBadge in workbench header |
| `package.json` | Added `guard:demo-data`, appended to `guard:all` |
| `src/stitch/surface_wiring_ledger.ts` | Sanitized two notes strings — placeholder names replace demo client names |

## Files NOT modified
`state/route.ts`, `BuddyCanonicalStateAdapter.ts`, `core/state/types.ts`,
`OmegaAdvisoryAdapter.ts`, `core/omega/types.ts`, `committee/page.tsx`,
`CommitteeDecisionPanel.tsx`

## Verification
- `tsc --noEmit` clean
- 24 tests pass
- `guard:demo-data` PASSED on main

## Architecture confirmed
- Omega annotates, never decides ✅
- `CommitteeDecisionPanel` is the only write action on committee surface ✅
- AnalystWorkbench spread/snapshot/extraction logic unchanged ✅
- OCC SR 11-7 boundary intact ✅

## Permanent build rules added
- `guard:demo-data` is in `guard:all` — blocks deploy on any demo string in src/
- Notes strings in ledger files must use generic placeholders, never client/deal names

## Key learning
Claude Code reported phantom commit SHA `8a599d87` for the ledger cleanup — it never reached origin/main. Matt pushed manually. **Verification pattern reminder: always check GitHub API for file content after every Claude Code AAR, never trust the reported SHA alone.**

## Next priorities
1. Reconciliation — `recon_status` NULL on ffcc9733 blocks Committee Approve signal
2. Observability — confirm Pulse events flowing beyond `deal.underwrite.verify`
3. Model Engine V2 — feature flag activation + DB seeding
4. Corpus expansion — 10+ verified docs needed for bank confidence
