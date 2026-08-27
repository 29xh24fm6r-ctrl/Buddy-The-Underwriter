# Buddy reminder-incident route-capacity commissioning — 2026-08-27

## Evidence

The exact current-main route budget was 2,001 of Vercel's 2,048-entry
deployment ceiling, leaving 47 entries. Eight super-admin reminder-incident
operations each occupied a separate App Router entry even though all share the
same runtime, authorization boundary, HTTP method, and operational domain.

## Repair

The eight historical POST URLs are now served by one fail-closed catch-all
dispatcher. Every implementation is an exact move into an ordinary TypeScript
handler module. Request bodies, query strings, authentication, Supabase
operations, response payloads, status codes, and production URLs remain
unchanged. Unknown paths return HTTP 404.

This removes seven route files and increases deployment headroom without
changing database schema, dependencies, permissions, or production data.

## Verification required before merge

- structural route-contract regression test;
- focused and complete unit/evaluation suites;
- typecheck, lint, architecture, safety, schema, upload, and Never-500 guards;
- route-budget comparison against current main;
- exact-head Vercel preview and signed-out HTTP probes for preserved 401,
  unknown-path 404, and unsupported-method 405 behavior;
- complete diff inspection.

This arc is independent of the open SignWell durability repair. Only Buddy The
Underwriter source and its owned deployment are in scope.
