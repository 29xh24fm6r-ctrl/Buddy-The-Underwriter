# SPEC HOTFIX-ROUTE-CAP-DEMO-REMOVAL — Production Restoration

**Date:** 2026-04-27 · **Owner:** Architecture (Matt) · **Executor:** Claude Code
**Status:** ready · **Type:** P0 hotfix · **Target:** ~21 manifest entries removed, production deploys green

## Background

Production has been red since 2026-04-25 16:07Z. ~45 hours and counting at spec authoring time. All 10 production deploys in the window failed with `errorCode: too_many_routes`. Self-identified in commit `26331c18` (PR #346, Sprint A.1): "errorCode 'too_many_routes' (2066/2048 cap)." PR #346 retired 6 dev/test/demo pages but did not drop below cap. PR #347 diagnostic (`d7b28c01`) confirmed manifest count still ~2066, and identified the dominant contributor as **~2x per-route RSC/data variant expansion**, not headers or stale routes.

Empirical confirmation from current `dpl_dqQQwbXZMHWVvsPayoWfir9p9qA7`: 982 functions + 19 static = 1001 logical routes, multiplier 2.064× to 2066 manifest entries.

This hotfix is scoped to clearing the cap. FIX-A consolidation (sibling-family merges, route dynamicization, structural cleanup) is a separate workstream that should run after production is green.

## Decision (Matt, 2026-04-27)

> "I dont want a demo, i am building a real product, so kill the demo."

Demo/sandbox product surface is killed. Combined with confirmed-dead Tier A routes, B18 redundant stitch page, and Cluster 2 admin/diagnostics for safety margin (per ChatGPT + Claude convergence — landing at exactly cap is brittle given ~15-entry calibration variance in route counter).

## Math

| Bucket | Files | Entries |
|---|---|---|
| Tier A (confirmed-dead routes) | 3 | 3 |
| Tier B Cluster 1 (demo/sandbox) | 11 (2 pages + 9 API) | 13 |
| Tier B Cluster 2 (admin/diagnostics) | 2 (1 page + 1 API) | 3 |
| B18 (redundant stitch page) | 1 | 2 |
| **Total** | **17 files** | **21 entries** |

Baseline: 2066. Target post-hotfix: ~2045. Margin below 2048 cap: ~3 entries.

## Pre-flight check — /admin/diagnostics

Before deleting Cluster 2, verify it's stale:

```bash
git log --oneline -- src/app/\(admin\)/admin/diagnostics/page.tsx | head -10
git log --oneline -- src/app/api/admin/pipeline/diagnostics/route.ts | head -10

grep -rn "/admin/diagnostics\|/api/admin/pipeline/diagnostics" src/ \
  --exclude-dir=__tests__ \
  | grep -v "^src/app/(admin)/admin/diagnostics/" \
  | grep -v "^src/app/api/admin/pipeline/diagnostics/"
```

**Decision rules:**
- If last modification within 30 days AND active grep hit from non-deleted production code → **stop and surface.** Don't kill.
- If both quiet → kill, proceed.

## Files to delete

```
# Tier A
src/app/api/admin/deals/[dealId]/auto-seed-lite/debug/route.ts
src/app/api/debug/pdf-worker/route.ts
src/app/api/_builder/deals/latest/route.ts

# Tier B Cluster 1
src/app/(admin)/admin/demo-hygiene/page.tsx
src/app/(admin)/admin/demo-access/page.tsx
src/app/api/admin/demo/access/list/route.ts
src/app/api/admin/demo/access/upsert/route.ts
src/app/api/admin/demo/access/remove/route.ts
src/app/api/admin/demo/hygiene/archive-old/route.ts
src/app/api/admin/demo/hygiene/purge-archived/route.ts
src/app/api/admin/demo/hygiene/reset/route.ts
src/app/api/sandbox/deals/route.ts
src/app/api/sandbox/deals/[dealId]/route.ts
src/app/api/sandbox/seed/route.ts

# Tier B Cluster 2 (only after pre-flight check)
src/app/(admin)/admin/diagnostics/page.tsx
src/app/api/admin/pipeline/diagnostics/route.ts

# B18
src/app/stitch/command-center-latest/page.tsx
```

## Coupled deletions

For each route file deleted, scan its imports. If a `src/lib/*` or `src/components/*` file is imported **only by the deleted set**, delete it too. Likely orphans:

- `src/lib/demo/*`
- `src/lib/sandbox/*`
- `DemoAccessClient`, `DemoHygieneClient`, `AdminJobDiagnostics` (only if B1 dies)

**Rule:** if uncertain whether something else imports the module, leave it alone. Tree-shaking handles dead code at build time. Don't over-delete — route count is what matters.

## Modifications

- `src/app/(admin)/admin/page.tsx` — remove links to deleted demo/diagnostics pages
- `AdminShell` component — remove demo/diagnostics nav entries
- `src/proxy.ts` — verify no `/sandbox/*` or `/admin/demo/*` matchers; remove if present
- `vercel.json` `crons` — verify no entries reference deleted routes; remove if present

## What NOT to touch

- `/borrower/*`, `/banker/*`, `/deals/*`, `/api/deals/*`, `/api/borrower/*`, `/api/banker/*`
- Underwriting workspace, voice gateway, document classification, auth/onboarding paths
- Lender marketplace and participation engine surfaces
- Tier B candidates not in this hotfix: B10 sba-canary, B11/B12 stress-test, B13 checklist/debug, B14 auth/debug — leave for separate review
- `src/proxy.ts` `/start(.*)` matcher — already correct
- Anything outside the explicit candidate list

## Branch

`hotfix/route-cap-demo-removal` from `main` HEAD.

## Verification

```bash
pnpm typecheck
pnpm build
node scripts/count-routes.mjs --mode=manifest
```

Decision tree on manifest count:
- **Below 2030:** ship it. Plenty of margin.
- **2030–2045:** ship it. Acceptable margin.
- **2045–2055:** stop and surface. Too close to cap given calibration variance.
- **Above 2055:** build/import deletion went wrong. Surface immediately.

If `pnpm typecheck` or `pnpm build` fails → stop and surface. Don't patch on the spot.

## Commit message

```
hotfix(routes): remove demo/sandbox product + admin diagnostics to clear too_many_routes cap

Production has been red since 2026-04-25 16:07Z (PR #346, errorCode:
too_many_routes, 2066/2048 cap). PR #346 retired 6 dev pages but
didn't drop below cap. PR #347 diagnostic confirmed dominant driver
is ~2x per-route RSC variant expansion.

This hotfix kills:
- Demo/sandbox product surface (13 manifest entries)
- 3 confirmed-dead admin/debug routes
- 1 redundant stitch static page (already served by /stitch/[slug])
- Admin diagnostics surface (safety margin, 3 entries)

Total: ~21 manifest entries removed.
Manifest count: 2066 → ~2045 (verify in CI).

Per Matt 2026-04-27: "I dont want a demo, i am building a real
product, so kill the demo."

References:
- specs/hotfix-route-cap/SPEC.md
- BUDDY_PROJECT_ROADMAP.md FIX-A workstream
- PR #346 (Sprint A.1) initial mitigation
- PR #347 RSC variant diagnostic
```

## PR

Title: `hotfix(routes): kill demo + admin/diagnostics to clear too_many_routes cap`

PR description must include:
1. Manifest count: baseline → post-hotfix
2. Files deleted (categorized: routes / libs / components)
3. Files modified
4. `pnpm typecheck` and `pnpm build` outputs

**Surface for Matt's approval. Do not merge unilaterally.**

## Post-merge

Watch production deploy on `main` after merge SHA. Confirm `readyState: READY`. If still ERROR:

```bash
npx vercel inspect <deployment-url>
```

- Still `too_many_routes`: count math was off, more cuts needed. Surface.
- Different errorCode: new failure introduced by deletion cascade. Surface.
- READY: production restored.

Run basic smoke: hit `https://buddytheunderwriter.com`, confirm load.

## AAR requirements

1. Hotfix branch + commit SHA + PR number
2. Manifest count: baseline → final
3. Files deleted (routes / libs / components separately)
4. Files modified
5. `pnpm typecheck` and `pnpm build` results
6. Post-merge deploy status
7. Production smoke check result
8. Update `HOTFIX_LOG.md` with the incident summary

## Out of scope (followups)

- FIX-A consolidation (sibling-family merges, dynamicization) — separate workstream
- Other Tier B candidates (sba-canary, stress-test, checklist/debug, auth/debug) — separate review
- `route-budget.yml` enforcement flip — after main is green and FIX-A baseline restored
- Node 18 → 24 runtime upgrade — flagged by Claude Code, separate task
- "Phantom content" build principle commit — separate
- SD-A re-scoping against 906 findings — separate

## Done condition

`pnpm typecheck && pnpm build` green on `main` post-merge. Vercel production deploy of merge SHA reaches `readyState: READY`. `https://buddytheunderwriter.com` loads. Manifest count below 2048 with margin.
