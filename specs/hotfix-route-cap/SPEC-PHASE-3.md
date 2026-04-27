# SPEC HOTFIX-ROUTE-CAP — Phase 3 (Redundant Header Rule)

**Date:** 2026-04-27 · **Owner:** Architecture (Matt) · **Executor:** Claude Code
**Status:** ready · **Type:** P0 hotfix continuation · **Target:** remove no-op header rule, see if manifest drops below cap

## Why a Phase 3

Phase 2 commit `ad23a676` deleted 9 orphan pages. Vercel inspector confirmed:

- `errorCode`: `too_many_routes`
- `received`: **2057** (down from 2060 in Phase 1)
- `max`: 2048
- **9 entries over cap**

Page deletions: 11 logical routes removed (985 → 974), but Vercel `received` only dropped by 3 (2060 → 2057). **Fixed overhead grew by 19 entries between builds** — likely Next.js internal route additions, RSC manifest growth, or header rule expansion.

We can't easily diagnose the overhead growth without invasive changes. But we can attack the explicit overhead we control: the `headers()` rules in `next.config.mjs`.

## Decision

Remove the first `headers()` rule in `next.config.mjs` — it's a documented no-op.

The rule:

```javascript
{
  source: "/_next/static/(.*)",
  headers: [
    { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
  ],
},
```

Per Next.js official documentation:

> "Next.js sets the Cache-Control header of `public, max-age=31536000, immutable` for truly immutable assets. **It cannot be overridden.** These immutable files contain a SHA-hash in the file name, so they can be safely cached indefinitely."

This rule duplicates what Next.js applies automatically. Removing it changes nothing at runtime but removes its entry from the `headers()` array, which may shrink the deployment manifest.

**Source:** https://nextjs.org/docs/pages/api-reference/config/next-config-js/headers (Phase 3 rule "It cannot be overridden")

## Files to modify

`next.config.mjs` — remove lines 38-49 (the `/_next/static/(.*)` rule). Keep all other header rules.

The full `headers()` function should retain:

1. ~~`/_next/static/(.*)` cache rule~~ — DELETE (no-op per Next.js docs)
2. `/((?!_next/static|_next/image|favicon.ico).*)` — KEEP (no-cache for HTML, this is intentional)
3. `/(.*)` security headers — KEEP (X-Frame-Options, CSP, etc.)
4. `/:base(credit-memo|deals)/:rest*` microphone permissions — KEEP

## Verification

```bash
pnpm typecheck
pnpm build
node scripts/count-routes.mjs --manifest --baseline 2032
```

Expected: small reduction in local manifest count. **Real test is post-merge Vercel deploy.**

If `pnpm typecheck` or `pnpm build` fails → stop and surface. (Won't happen — it's a config change, not code.)

## Commit on existing branch

Same `hotfix/route-cap-demo-removal` branch. Don't create a new branch.

```
hotfix(routes/phase-3): remove redundant /_next/static cache header rule

Per Next.js docs: "Next.js sets the Cache-Control header of public,
max-age=31536000, immutable for truly immutable assets. It cannot be
overridden."

The rule in next.config.mjs duplicating this header is a documented
no-op. Removing it shrinks the deployment manifest with zero runtime
behavior change.

Phase 2 deploy: errorCode=too_many_routes, received=2057, max=2048.
Still 9 over cap after 11 logical routes deleted (page-only).

Source: https://nextjs.org/docs/pages/api-reference/config/next-config-js/headers
```

## Update PR #353

Update PR #353 description to reflect Phase 3. Surface for Matt's approval.
**Do not merge unilaterally.**

## Post-merge

Same protocol. Watch deploy. Three outcomes:

- **READY:** Production restored. Update HOTFIX_LOG.md.
- **`too_many_routes` with `received` 2049-2057:** Phase 4 needed. Likely cut 1-3 more candidates from unaudited page set (`/health`, `/security`, `/contact`, `/voice`, etc.).
- **`too_many_routes` with `received` ≥ 2058:** rule removal didn't help, the manifest math is more opaque than we thought. Stop and re-strategize — likely time to explore Project Routes or Proxy Project structurally.
- **Different errorCode:** new failure introduced (unlikely from a config-only change). Surface and stop.

## AAR requirements

1. Phase 3 commit SHA on `hotfix/route-cap-demo-removal`
2. PR #353 updated description
3. Local manifest count: 1983 → final
4. Post-merge Vercel deploy status
5. If failed: new `received` count from inspector
6. If READY: production smoke check + HOTFIX_LOG.md update

## Out of scope

Same followup list as Phase 2. Adding:
- **Investigate why fixed overhead grew 19 entries between Phase 1 and Phase 2** — non-obvious cause; might be Next.js internal route additions or RSC manifest growth. Diagnostic work, not hotfix work.
