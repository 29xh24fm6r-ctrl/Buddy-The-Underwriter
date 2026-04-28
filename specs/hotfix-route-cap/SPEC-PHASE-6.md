# SPEC HOTFIX-ROUTE-CAP — Phase 6 (Combined Attack to Clear Cap)

**Date:** 2026-04-27 · **Owner:** Architecture (Matt) · **Executor:** Claude Code
**Status:** ready · **Type:** P0 hotfix decisive · **Target:** clear too_many_routes cap in single PR, restore production

## Why a Phase 6

Sequential phase strategy has hit diminishing returns. Phase 5 smoke test confirmed Project Routes is manifest-independent (synthetic rule added with 0 manifest cost) but math shows Project Routes alone won't clear cap when combined with Phase 1-3 deletions:

- Current `main`: 2066 (confirmed by Phase 5 smoke test inspector reading)
- After PR #353 merge (Phase 1-3 deletions): 2056 (Phase 3 reading)
- After Project Routes header migration (3 rules at ~0 each based on smoke test): 2053 best case
- **Still 5 over cap.**

Combining all available reductions in one PR is the path to green. Production red 50+ hours costs more than temporary marketing-flow regression on `/contact` and `/security`.

## Decision (Matt, 2026-04-27)

> "Path 1"

Combined attack with marketing regression accepted. Repair marketing surface in <30 min after production goes green.

## Scope (5 changes in single PR)

### Change 1: Rebase PR #353 onto latest main

PR #353 has Phases 1-3 deletions on `hotfix/route-cap-demo-removal` from commit `434011a2`. Main has advanced (Phase 5 spec commits at `445d51e` and Phase 6 spec).

Rebase `hotfix/route-cap-demo-removal` onto current `main` HEAD. Resolve any conflicts (none expected — spec commits don't touch source code).

### Change 2: Phase 4 v3 page deletions + coupled mods

**Pages deleted (5):**
```
src/app/health/page.tsx
src/app/voice/page.tsx
src/app/borrower-portal/page.tsx
src/app/login/page.tsx
src/app/signup/page.tsx
```

**Coupled modifications (8 files):**
- `src/lib/auth/requireDealAccess.ts:39` — change `redirect("/borrower-portal")` → `redirect("/borrower/portal")` (canonical, file's own intent per its comment)
- `src/components/nav/HeroBar.tsx:9` — drop `/borrower-portal` nav entry
- `src/components/nav/HeroBarGrouped.tsx:11` — drop `/borrower-portal` nav entry
- `src/components/nav/ConditionalHeroBar.tsx:19` — drop `pathname.startsWith("/borrower-portal")` check
- `src/components/NavBar.tsx:17,20` — change `/login` → `/sign-in`, `/signup` → `/sign-up`
- `src/components/marketing/PricingTable.tsx:132` — change `/signup` → `/sign-up`
- `src/proxy.ts:31` — drop `"/borrower-portal(.*)",` matcher
- `src/app/robots.ts:8,26` — drop `/login`, `/signup`, `/borrower-portal` references

### Change 3: Marketing-flow page deletions + temporary CTA recovery

**Pages deleted (2 additional):**
```
src/app/contact/page.tsx
src/app/security/page.tsx
```

**Coupled modifications for /contact (6 callers):**
- `src/app/tenant/select/page.tsx:58` — change `href="/contact"` → `href="mailto:hello@buddytheunderwriter.com"`
- `src/components/marketing/PricingTable.tsx:57,74,79,124` — change `window.location.href = "/contact"` → `window.location.href = "mailto:hello@buddytheunderwriter.com"` (4 occurrences)
- `src/components/marketing/MarketingPage.tsx:386` — change `href="/contact"` → `href="mailto:hello@buddytheunderwriter.com"`

**Coupled modifications for /security (1 caller):**
- `src/components/marketing/MarketingPage.tsx:411` — remove the `<Link>` to `/security` entirely from footer

**Note on email destination:** `hello@buddytheunderwriter.com` is a placeholder. If a different inbox is preferred and known to be live, use that instead. If unknown, use the placeholder — better than 404. Will be repointed in <30 min follow-up after production green.

### Change 4: Project Routes header migration (Vercel dashboard config, no commit)

Configure 3 header rules at Vercel project level via dashboard or `vercel routes` CLI:

**Rule 1 (no-cache for HTML):**
- Source: `/((?!_next/static|_next/image|favicon.ico).*)`
- Header: `Cache-Control: no-cache, no-store, must-revalidate`

**Rule 2 (security headers):**
- Source: `/(.*)`
- Headers:
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

**Rule 3 (microphone allowed for Gemini Live banker interviews):**
- Source: `/:base(credit-memo|deals)/:rest*`
- Header: `Permissions-Policy: camera=(), microphone=self, geolocation=()`

**Critical ordering:** add all 3 rules to Project Routes BEFORE the next change (delete from `next.config.mjs`). If we delete first then add, there's a window where security headers are missing in production. **Add first, verify in dashboard, then delete from `next.config.mjs` in the next commit.**

After publishing all 3 rules, verify via `vercel routes list` (or dashboard) and via curl against any READY deploy alias from main:

```bash
curl -I https://buddy-the-underwriter-git-main-mpalas-projects-a4dbbece.vercel.app/
# Expect all 5 security headers present
curl -I https://buddy-the-underwriter-git-main-mpalas-projects-a4dbbece.vercel.app/credit-memo/test
# Expect Permissions-Policy with microphone=self
```

If any expected header is missing, **STOP** — do not proceed to Change 5. Diagnose the Project Routes config issue first.

### Change 5: Remove `headers()` function from `next.config.mjs`

Only after Change 4 verified, edit `next.config.mjs`:

Remove the entire `async headers()` function and its return value (the 3-rule array). Keep all other config.

Verify locally: `pnpm typecheck && pnpm build` should pass — `headers()` is config-only, no runtime impact at build time.

## Pre-merge verification (REQUIRED)

After all changes commit to `hotfix/route-cap-demo-removal`, before merging PR #353 to main:

1. **Vercel preview deploy:** wait for the auto-deploy on the hotfix branch
2. **Read inspector:** `received` count should be ≤ 2045 (target: 8 entries margin below cap)
3. **Curl preview URL for header verification:**
   ```bash
   PREVIEW_URL=https://<preview-deploy-url>.vercel.app
   curl -I $PREVIEW_URL/                                  # expect security headers
   curl -I $PREVIEW_URL/api/health                        # expect security headers + no-cache
   curl -I $PREVIEW_URL/sign-in                           # expect security headers + no-cache
   curl -I $PREVIEW_URL/credit-memo/test                  # expect microphone=self
   curl -I $PREVIEW_URL/deals/test                        # expect microphone=self
   ```
   All 5 must show expected headers. If any are missing, **STOP** — Project Routes didn't apply correctly. Re-add the missing rule to `next.config.mjs` as emergency fallback before merging.

4. **If preview READY and headers verified:** surface AAR for Matt's merge approval.
5. **If preview still fails:** read inspector for new `received` count. Surface for Matt's call.

## Post-merge

1. Watch production deploy on `main`
2. Confirm `readyState: READY`
3. Production smoke check:
   ```bash
   curl -I https://buddytheunderwriter.com/
   curl -I https://buddytheunderwriter.com/api/health
   curl -I https://buddytheunderwriter.com/sign-in
   ```
4. Verify all expected headers present in production responses
5. **Immediately queue follow-up work (not part of this PR):**
   - Marketing CTA repoint (replace mailto: placeholders with whatever Matt prefers — Calendly, contact form, dedicated inbox)
   - Restore `/contact` and `/security` as proper pages if/when marketing team has time

## What NOT to touch

- Borrower core, banker core, deals, document processing, lender routing, underwriting flows, voice gateway (Gemini), AI screen generator (`/generate`, `/s/[id]`)
- `/start` (borrower SBA onboarding concierge)
- `/upgrade` (AI screen generator monetization)
- `/sign-in`, `/sign-up` (canonical Clerk auth)
- `/(marketing)/for-banks`, `/(marketing)/pricing` (real marketing surfaces)
- All previously-protected routes from Phase 1-3

## Verification (workstation, before commit)

```bash
pnpm typecheck
pnpm build
node scripts/count-routes.mjs --manifest --baseline 2032
```

**Decision tree on local manifest count:**

- Local ≤ 1965: build worked, proceed to push
- Local 1966-1975: deletions partial, surface
- Local > 1975: deletions failed, stop

If `pnpm typecheck` or `pnpm build` fails → stop and surface.

## Commit strategy

Two commits on `hotfix/route-cap-demo-removal` (after rebase):

**Commit 1:** Combined page deletions + coupled mods (Changes 2 + 3)
```
hotfix(routes/phase-6a): kill 7 pages + coupled marketing/auth/nav mods

Phase 4 v3 hygiene + /contact and /security marketing pages.

Pages deleted: /health, /voice, /borrower-portal, /login, /signup,
/contact, /security

Coupled mods: requireDealAccess.ts redirect → /borrower/portal,
3 nav components drop /borrower-portal entries, NavBar.tsx and
PricingTable.tsx repoint /login→/sign-in /signup→/sign-up,
proxy.ts drops /borrower-portal matcher, robots.ts cleanup,
marketing CTAs repoint /contact → mailto: temporary fallback,
/security footer link removed.

Marketing CTA mailto: is temporary; immediately follow-up to
repoint after production green per Matt 2026-04-27.

Per Matt 2026-04-27: "Path 1" — accept marketing regression to
restore production fastest.
```

**Commit 2:** Project Routes header migration (Change 5 — Change 4 is dashboard config, not commit)
```
hotfix(routes/phase-6b): remove headers() from next.config.mjs (migrated to Project Routes)

3 header rules moved to Vercel Project Routes (configured pre-commit
via dashboard, verified active before this commit pushed):
- /((?!_next/static|_next/image|favicon.ico).*) → no-cache HTML
- /(.*) → security headers (X-Frame, CSP, etc.)
- /:base(credit-memo|deals)/:rest* → microphone=self

Project Routes confirmed manifest-independent via Phase 5 smoke
test (received unchanged at 2066 baseline with synthetic rule
active).

Removes 3 headers() rules from deployment manifest; permanent
escape from this incident class for future header changes.
```

## Update PR #353

After both commits land:

1. Update PR title: `hotfix(routes): combined attack — Phases 1-3 + Phase 4 hygiene + marketing pages + Project Routes migration to clear too_many_routes cap`
2. Update PR description with full Phase 1-6 timeline
3. Surface for Matt's approval. **Do not merge unilaterally.**

## AAR requirements

1. Rebase commit SHA + any conflict resolution notes
2. Commit 1 SHA (Phase 6a — page deletions + coupled mods)
3. Commit 2 SHA (Phase 6b — headers() removal)
4. Project Routes dashboard screenshot or `vercel routes list` output showing all 3 rules configured
5. Local manifest count: 1982 → final
6. `pnpm typecheck` and `pnpm build` results
7. PR #353 updated description URL
8. Pre-merge preview deploy `received` count from inspector
9. Pre-merge curl verification output (5 URLs, expected headers each)
10. Decision: ready to merge OR surface for more cuts
11. (Post-merge after Matt approves) production smoke results + HOTFIX_LOG.md update

## Out of scope

- Marketing CTA permanent repoint (immediate follow-up after production green)
- Restore `/contact` and `/security` as proper pages (marketing team work)
- Proxy Project architecture (long-term, only if cap issues recur)
- Phase 4 v3's `/api/realtime/*` cleanup (likely orphan after `/voice` deletion)
- Investigate fixed-overhead growth between builds
- Node 18 → 24 runtime upgrade
- `route-budget.yml` enforcement flip
- Vercel REST API token for automated `received` reads
- Phantom content build principle commit
- SD-A re-scope, SD-C false-positive sample
- Bucket 2 family merges (FIX-A workstream)

## Done condition

Production deploy of merge SHA reaches `readyState: READY`. `https://buddytheunderwriter.com` loads. All 5 expected headers present in production responses (verified via curl). Manifest count below 2048 with margin.
