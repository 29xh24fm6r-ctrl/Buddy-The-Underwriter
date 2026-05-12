# Route Budget

- Vercel's hard route limit is `2048`.
- Buddy emergency production deploys failed at `2053` routes with `too_many_routes`.
- Local `.next/routes-manifest.json` can undercount relative to Vercel's real deploy-time route accounting.
- The source of truth is `.vercel/output/config.json` after `npx vercel build --prod`.
- Do not add new `app/api` routes casually.
- Prefer dispatch under existing admin/internal endpoints when behavior can safely share a route.
- Debug and dev routes must not ship to production.
- Any route-budget PR must report before/after `.vercel/output/config.json` counts.

## Guardrail

- Run `pnpm route-budget`.
- Warning threshold: `1980`
- Error threshold: `2020`
- The command fails when the Vercel-counted route total is `>= 2020`.

## Workflow

1. Run `npx vercel build --prod`.
2. Run `pnpm route-budget`.
3. If the count is near the threshold, stop adding routes and consolidate under existing surfaces instead.
