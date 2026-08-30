# Legacy AI control-plane retirement

Date: 2026-08-30

Scope: Buddy The Underwriter only.

## Evidence

Four production routes under `/api/ai/*` formed an isolated legacy/demo control plane:

- `command` accepted caller-supplied context and sent it to the AI provider.
- `underwrite` accepted an arbitrary deal identifier and returned provider/internal error text.
- `credit-memo` defaulted to a demo deal and deliberately generated seeded placeholder context when no authoritative deal row existed.
- `execute` accepted any authenticated caller's deal identifier, treated a caller-controlled boolean as approval, mutated only process memory, and returned the mutation as applied together with a process-memory audit event.

Repository code search found no product caller for any of the four endpoints. Their executor and audit dependencies explicitly identify themselves as in-memory demo storage, so the routes could not provide durable Buddy underwriting evidence.

## Repair

- Remove all four legacy route handlers from the production route tree.
- Preserve the underlying shared libraries because other non-route tests or development code may still depend on them.
- Add a regression guard that requires the route files to remain absent, forbids product callers for their endpoint paths, and prevents API routes from importing the process-memory action executor or audit store.

## Verification target

- Focused Node regression guard.
- Complete diff inspection.
- Required CI, build, security, route-budget, and public browser checks.
- Exact-head Vercel preview: each retired endpoint must return HTTP 404 while the public Buddy surface remains healthy.
- Production closure after merge: repeat the four 404 probes against `www.buddysba.com`.

No database, schema, credentials, provider configuration, production data, or other product is changed.
