# SPEC HOTFIX-ROUTE-CAP — Phase 2 Addendum (Page Cuts)

**Date:** 2026-04-27 · **Owner:** Architecture (Matt) · **Executor:** Claude Code
**Status:** ready · **Type:** P0 hotfix continuation · **Target:** 18 additional manifest entries removed, production deploys green

## Why a Phase 2

Phase 1 (commit `4528255a` on branch `hotfix/route-cap-demo-removal`, PR #353) removed 17 files / ~31 local manifest entries. Vercel inspector confirmed result:

- `errorCode: too_many_routes`
- `received: 2060`
- `max: 2048`
- **Still 12 entries over cap**

The 6:31 ratio (Vercel only counted 6 of 31 deletions) revealed calibration insight:

- **API routes:** ~1 manifest entry each in Vercel's actual count
- **Pages:** ~2 manifest entries each (page + RSC variant)
- **Local script over-counted API routes by ~2×**

Phase 1 was 11 API routes (~11 entries to Vercel) + 4 pages (~8 entries to Vercel) + ~12 entries of overhead corrections = ~6 net entries reduced. Math is consistent.

## Decision (Matt, 2026-04-27 ~3pm ET)

> "the AI screen generator is a real thing, we want to be able to show borrowers options and things"

`/generate` and `/s/[id]` are **kept** — part of the borrower-options product, not a side-thing. P10 and P11 from Claude Code's page audit are explicitly retained.

## Path: A — 9 confident page kills only

Page deletions only this round. Each ~2 entries. 9 pages = ~18 manifest entries reduced.

Projected: 2060 - 18 = **2042** (margin 6 below cap).

Margin 6 is below the 8-target but is acceptable for this round because the calibration uncertainty is symmetric in our favor — page deletions match Vercel's 2× weighting consistently, unlike the asymmetric API-route over-count from Phase 1.

## Pre-flight check — confirm no recent activity on candidates

For each page candidate below, verify:

```bash
git log --oneline -- <path> | head -5
```

If any candidate has been modified within the last 14 days AND has a non-test caller in `src/`, **stop and surface.** Don't kill that candidate.

(14-day threshold instead of 30-day — these are lower-risk candidates than admin/diagnostics was, and we've already validated the methodology.)

## Files to delete — Phase 2

Pages (9 files, ~18 manifest entries):

```
src/app/(app)/eval/page.tsx                    # P1 — Phase 54 Eval Dashboard, env-gated, 0 callers
src/app/(app)/governance/page.tsx              # P2 — Governance Command Center, 0 callers
src/app/(app)/policy/page.tsx                  # P3 — Living Credit Policy, only inbound was P2
src/app/(admin)/roles/page.tsx                 # P4 — duplicate; canonical is /admin/roles
src/app/(admin)/rules/page.tsx                 # P5 — admin rules JSON pusher, 0 callers
src/app/(app)/builder/wire-check/page.tsx      # P6 — internal stitch wiring inspector
src/app/workload/page.tsx                      # P7 — 9-line ShellPage stub
src/app/share/[artifactId]/page.tsx            # P8 — only does redirect(`/s/${artifactId}`), redundant with /s/[id]
src/app/(app)/risk/page.tsx                    # P9 — top-level orphan; deal-scoped /deals/[id]/risk does the work
```

## Coupled deletions

For each page deletion, scan imports. Likely orphans (verify before deleting):

- Any `*Client.tsx` component imported only by the deleted page
- Any `src/lib/*` module imported only by the deleted page

**Rule unchanged from Phase 1:** if uncertain, leave it alone. Tree-shaking handles dead code. Route count is what matters.

## Modifications

- `src/app/(app)/admin/page.tsx` — verify no remaining links to deleted pages; remove if present
- `AdminShell` component — verify nav has no entries to deleted pages; remove if present
- `src/lib/stitch/registry.ts` — already includes "Roles Permissions Control" → `/admin/roles` (canonical), so killing `(admin)/roles` doesn't affect registry. Verify.
- Other nav components — check for hard-coded `/eval`, `/governance`, `/policy`, `/risk`, `/workload`, `/share/`, `/builder/wire-check`, `/roles`, `/rules` references. Modify or remove.

## What NOT to touch (carries from Phase 1)

- `/borrower/*`, `/banker/*`, `/deals/*`, `/api/deals/*`, `/api/borrower/*`, `/api/banker/*`
- `/generate` and `/s/[id]` — borrower-options product, **explicitly kept**
- `/admin/*` (the real admin surface, not duplicates we're killing)
- Auth/onboarding paths
- Underwriting workspace, voice gateway, document classification
- Lender marketplace and participation engine surfaces
- Anything outside the explicit candidate list

## Verification

```bash
pnpm typecheck
pnpm build
node scripts/count-routes.mjs --manifest --baseline 2032
```

Decision tree on Vercel projected count (2060 - measured-entries-removed):

- **Projected ≤ 2040 (margin ≥ 8):** ship it. Comfortable.
- **Projected 2041–2045 (margin 3–7):** ship it. Acceptable for this round given page-only deletion's consistent weighting.
- **Projected 2046–2055:** stop and surface. Need to find more candidates or accept Path C.
- **Projected > 2055:** build/import cascade went wrong. Surface immediately.

If `pnpm typecheck` or `pnpm build` fails → stop and surface. Don't patch.

## Commit on existing branch

Commit Phase 2 deletions to existing `hotfix/route-cap-demo-removal` branch. Don't create a new branch — keep PR #353 as the single hotfix unit.

```
hotfix(routes/phase-2): kill 9 orphan pages to clear too_many_routes cap

Phase 1 (commit 4528255a) removed 31 entries locally but only 6 in Vercel's
actual count (2066 → 2060). Inspector confirmed errorCode:too_many_routes,
received:2060, max:2048. Still 12 over cap.

Phase 2 cuts 9 orphan pages (2 entries each = ~18 manifest entries):
- /eval, /governance, /policy — top-level orphans, 0 callers
- /roles, /rules — admin duplicates of canonical /admin/roles, /admin/rules
- /builder/wire-check — internal stitch inspector
- /workload — 9-line stub
- /share/[artifactId] — redundant redirect to /s/[id]
- /risk — top-level orphan; deal-scoped variant does the work

Per Matt 2026-04-27: AI screen generator (/generate, /s/[id]) is real
product (borrower options), explicitly kept.

Calibration insight from Phase 1: API routes count ~1 entry, pages ~2.
Phase 2 is page-only deletions for predictable weighting.

Projected: 2060 → 2042 (margin 6 below cap).
```

## Update PR #353

After Phase 2 commit lands on the branch:

1. Update PR title: `hotfix(routes): demo product + admin diagnostics + 9 orphan pages to clear too_many_routes cap`
2. Update PR description to reflect Phase 2 additions
3. Surface for Matt's approval. **Do not merge unilaterally.**

## Post-merge

Same protocol as Phase 1. After merge to main, watch production deploy:

```bash
npx vercel inspect <deployment-url>
```

Critical: this is the moment of truth. Three outcomes:

- **READY:** Production restored. Update HOTFIX_LOG.md, run smoke check.
- **Still `too_many_routes`** with `received` between 2049-2060: Phase 3 needed. Surface count, propose 1-3 more page candidates.
- **Different errorCode:** New failure introduced by deletion cascade. Surface and stop. Likely a missed orphan.

## AAR requirements

1. Phase 2 commit SHA
2. PR #353 updated description URL
3. Local manifest count: 2001 → final (post-Phase-2 local)
4. Vercel projected count after Phase 2
5. Files deleted (pages / coupled components / coupled libs separately)
6. Files modified
7. `pnpm typecheck` and `pnpm build` results
8. Post-merge deploy status (the critical line)
9. Production smoke check result
10. Update `HOTFIX_LOG.md` once green

## Out of scope (followups for next session)

These are the strategic answers to the route-cap problem long-term:

- **Proxy Project architecture** (Vercel KB option 3): split Buddy into Buddy-Public + Buddy-App. Each gets own 2048 cap. Effective budget: 4096. Multi-day spec.
- **Project-Level Routes** (Vercel March 2026 feature): move headers/redirects to dashboard-level rules independent of deployment manifest. Untested in our codebase.
- **Bucket 2 family merges** (FIX-A workstream): consolidate sibling routes via path-to-regexp alternation
- **ISR for deal-scoped pages** (FIX-A workstream): reduce per-build manifest cost
- Node 18 → 24 runtime upgrade
- `route-budget.yml` enforcement flip — after FIX-A restores cushion
- "Phantom content" build principle commit — separate
- SD-A re-scoping against 906 findings — separate
- SD-C false-positive sample check — separate

## Done condition

Same as Phase 1: production deploy of merge SHA reaches `readyState: READY`. `https://buddytheunderwriter.com` loads. Manifest count below 2048 with margin.
