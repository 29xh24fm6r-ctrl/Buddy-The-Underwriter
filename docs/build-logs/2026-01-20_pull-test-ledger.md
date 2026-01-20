# Pull + Test Ledger — 2026-01-20 (America/New_York)

| ts | area | env | action | expected | actual | status | evidence | owner | next |
|---:|------|-----|--------|----------|--------|--------|----------|-------|------|
| 2026-01-20 20:08:54 UTC | typecheck | local | pnpm -s typecheck | pass | TS errors in scripts/__tests__/verify-underwrite.test.ts, src/lib/deals/underwriteVerifyLedger.ts | fail | typecheck output | copilot | fix types |
| 2026-01-20 20:10:39 UTC | test:unit | local | pnpm -s test:unit | pass | server-only import error + lifecycle guard assertion | fail | test output | copilot | fix server-only import + update test expectation |
| 2026-01-20 20:11:43 UTC | preview | vercel | curl /api/_builder/verify/underwrite | 200 json | 404 html (not found) | fail | curl output | copilot | use /api/builder/verify/underwrite + real dealId |
| 2026-01-20T20:11:31Z | verify-underwrite | vercel-preview | curl /api/_builder/verify/underwrite | route exists + JSON | 404 HTML not-found (x-clerk-auth-status: signed-out) | fail | BASE=https://buddy-the-underwriter-5s02dzxwg...; x-matched-path=/_not-found | matt | commit+push branch, redeploy, re-test |
