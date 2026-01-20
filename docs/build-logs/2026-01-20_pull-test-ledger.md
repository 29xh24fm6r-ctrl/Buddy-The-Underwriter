# Pull + Test Ledger — 2026-01-20 (America/New_York)

| ts | area | env | action | expected | actual | status | evidence | owner | next |
|---:|------|-----|--------|----------|--------|--------|----------|-------|------|
| 2026-01-20 20:30:19 UTC | preview | vercel | curl /api/pipeline/latest | json with dealId | html (auth) | fail | pipeline/latest returned HTML | copilot | use builder mint w/token |
| 2026-01-20 20:30:19 UTC | preview | vercel | POST /api/builder/deals/mint | 200 json | 500 empty (x-clerk-auth-status: signed-out) | fail | curl -i mint | copilot | investigate middleware auth for builder routes |
| 2026-01-20 20:35:05 UTC | preview | vercel | GET /api/builder/token/status | auth true | auth false (token mismatch) | fail | token/status 200 auth:false | copilot | need correct BUDDY_BUILDER_VERIFY_TOKEN |
| 2026-01-20T??:??:??Z | builder-token | vercel-preview | token/status diag | env/header hashes visible | currently only env hash visible; auth=false | in_progress | need envHash vs headerHash raw+trim | matt | implement token/status dual-hash diagnostics |
| 2026-01-20T??:??:??Z | builder-token | vercel-preview | token/status diag | env/header hashes visible | currently only env hash visible; auth=false | in_progress | need envHash vs headerHash raw+trim | matt | implement token/status dual-hash diagnostics |
| 2026-01-20 21:20:14 UTC | builder-token | vercel-preview | token/status diag | json | html (deployment building) | fail | instant-preview-site build page | copilot | retry after deploy ready |
