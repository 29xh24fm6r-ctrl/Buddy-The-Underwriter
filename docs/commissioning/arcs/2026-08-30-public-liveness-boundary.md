# Public liveness boundary — 2026-08-30

## Scope

Buddy The Underwriter's public `GET /api/health` endpoint only.

## Production evidence

On 2026-08-30 the unauthenticated production endpoint returned HTTP 200 while disclosing the exact Vercel deployment ID, deployment hostname, Git commit SHA and ref, environment name, and integration enablement/connection diagnostics. It also reported top-level `ok: true` independently of the integration result.

## Root cause

A public liveness probe was coupled to an external provider diagnostic and serialized deployment and integration configuration directly to unauthenticated callers. This made a basic uptime probe depend on a supporting provider and exposed operational topology that is unnecessary for liveness.

## Repair

- Return a constant, bounded liveness contract containing only `ok`, `status`, and the canonical service name.
- Remove provider calls and deployment/environment serialization from the public boundary.
- Disable caching explicitly so monitors receive current process reachability.
- Preserve detailed authenticated diagnostics at their existing admin-only boundary.
- Add behavioral regression coverage for the exact response and forbidden diagnostic fields.

## Validation

Code head `9e7fbe767508f2c8db8e5b46926888a0790a0132` has a READY exact-head Vercel deployment after a successful production-equivalent build. The preview endpoint returns HTTP 200 with exactly the bounded three-field JSON contract and explicit no-store caching. No warning/error/fatal logs or grouped runtime errors appeared.

GitHub Actions remains externally blocked: CI, Build Check, Secret Scan, and Route Budget each failed before executing any step, with `steps: null` and no logs. The repair is not merge-ready until repository Actions runner/billing availability is restored and all four checks execute and pass.

## Closure

After merge and deployment, prove the public endpoint returns the bounded contract with HTTP 200 and that no deployment or provider details appear in the response or runtime logs.
