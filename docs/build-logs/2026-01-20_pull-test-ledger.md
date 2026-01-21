# Pull + Test Ledger — 2026-01-20 (America/New_York)

| ts | area | env | action | expected | actual | status | evidence | owner | next |
|---:|------|-----|--------|----------|--------|--------|----------|-------|------|
| 2026-01-20 20:30:19 UTC | preview | vercel | curl /api/pipeline/latest | json with dealId | html (auth) | fail | pipeline/latest returned HTML | copilot | use builder mint w/token |
| 2026-01-20 20:30:19 UTC | preview | vercel | POST /api/builder/deals/mint | 200 json | 500 empty (x-clerk-auth-status: signed-out) | fail | curl -i mint | copilot | investigate middleware auth for builder routes |
| 2026-01-20 20:35:05 UTC | preview | vercel | GET /api/builder/token/status | auth true | auth false (token mismatch) | fail | token/status 200 auth:false | copilot | need correct BUDDY_BUILDER_VERIFY_TOKEN |
| 2026-01-20T??:??:??Z | builder-token | vercel-preview | token/status diag | env/header hashes visible | currently only env hash visible; auth=false | in_progress | need envHash vs headerHash raw+trim | matt | implement token/status dual-hash diagnostics |
| 2026-01-20T??:??:??Z | builder-token | vercel-preview | token/status diag | env/header hashes visible | currently only env hash visible; auth=false | in_progress | need envHash vs headerHash raw+trim | matt | implement token/status dual-hash diagnostics |
| 2026-01-20 21:20:14 UTC | builder-token | vercel-preview | token/status diag | json | html (deployment building) | fail | instant-preview-site build page | copilot | retry after deploy ready |
| 2026-01-20 21:30:42 UTC | builder-token | vercel-preview | token/status diag | env/header hash match | CASE A: envHashTrim != headerHashTrim | fail | envHashTrim=sha256:3dff47968113 headerHashTrim=sha256:18552ac63a71 authTrim=false | copilot | align preview env token with local token (or vice versa) |
| 2026-01-20T22:xx:xxZ | verify-underwrite | preview | intake gate | deal found; complete_intake | missing borrower,intake_lifecycle,credit_snapshot; lifecycle column missing | in_progress | make schema-safe + add builder seed intake prereqs | matt | implement schema-safe lifecycle probe + builder seed intake prereqs |
