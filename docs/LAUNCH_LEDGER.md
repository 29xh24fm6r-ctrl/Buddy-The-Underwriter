# Buddy Launch Ledger (Single Canonical Table)

| id | area | severity | finding | fix | verification | owner | status |
|---:|------|----------|---------|-----|--------------|-------|--------|
| 1 | Auth/Middleware | CRITICAL | No canonical middleware file; auth/redirect behavior inconsistent | Add `src/middleware.ts` (Clerk) with explicit public/protected routes | `curl -I /health` (200), `curl -I /deals` (302 to /sign-in if signed out) | you | TODO |
| 2 | Stitch | CRITICAL | StitchFrame HTML has mismatched `<style>` tags (can cause blank renders) | Close missing `</style>` and add guardrails | Load Stitch routes; no blank pages | you | TODO |
| 3 | Error Handling | HIGH | No global `error.tsx` / `not-found.tsx` => "white page" on crash | Add root error/not-found + Stitch error boundary | Force error; see UI not blank | you | TODO |
| 4 | Env/Secrets | CRITICAL | No strict env validation => prod runtime 500s | Add zod env schemas for server/client | `node -e "require('./dist/server.js')"` after build | you | TODO |
| 5 | Observability | HIGH | No health endpoint / request id | Add `/api/health` + `/health` page + request id helper | `curl /api/health` returns JSON with ok | you | TODO |
| 6 | Rate Limiting | HIGH | AI endpoints can be spammed / cost blowups | Add simple rate limiter + guard wrapper; apply to AI routes | Hammer test; should 429 | you | TODO |
| 7 | Security Headers | MED | Headers too minimal; no nosniff/referrer policy | Add baseline headers (safe) | `curl -I /` shows headers | you | TODO |
