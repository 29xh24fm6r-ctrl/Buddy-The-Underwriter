# Golden Trident lock janitor integrity — 2026-08-30

## Scope

Buddy The Underwriter's owned `/api/workers/lock-janitor` recovery path and its two product-owned RPC result boundaries.

## Evidence and root cause

- The route serialized released database process ids/advisory keys and reconciled bundle/deal ids into responses and runtime logs.
- Raw database messages crossed the scheduled HTTP boundary.
- Null, malformed, duplicate, or oversized RPC results were accepted through unchecked casts.
- A rejected RPC promise could bypass the route's explicit failure contract.

That allowed incomplete recovery to appear green and exposed internal identifiers in operational telemetry.

## Repair

- Validate both RPCs through a pure bounded outcome helper.
- Require documented row shapes, safe integer lock evidence, bounded Trident identities/stages, uniqueness, and result limits.
- Use `Promise.allSettled` and return deterministic HTTP 503 outcomes for rejected, errored, or malformed work.
- Return and log count-only evidence.
- Enforce no-store responses.
- Add seven behavioral helper cases and four route-contract guards.

## Safety

Source, tests, and commissioning evidence only. No RPC, schema, credential, provider setting, production row, bundle, lock, deployment, storage object, dependency, destructive action, or cross-product change.

## Closure

Exact-head preview and CI evidence will be recorded after PR creation. Transactional closure requires the verified Buddy-owned Supabase project and authorized stale-lock and abandoned-bundle fixtures.
