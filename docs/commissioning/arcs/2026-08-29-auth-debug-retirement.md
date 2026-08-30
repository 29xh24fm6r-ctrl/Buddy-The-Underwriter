# Production authentication debug-surface retirement

Date: 2026-08-29

## Scope

Buddy The Underwriter authentication diagnostics and the deployed
`www.buddysba.com/api/auth/debug` route only.

## Production evidence

A public, signed-out request to `/api/auth/debug` returned HTTP 200 on
2026-08-29 with the internal marker `debug_v2_await_auth`. Source inspection
proved that the same route returned the current Clerk user id, session id, first
email address, and user-presence flag whenever a visitor had an authenticated
session.

The route had no product behavior, authorization gate, role restriction, or
environment restriction. It was a production diagnostic surface.

## Repair

- Remove the App Router endpoint so the path resolves through the normal 404
  boundary and cannot serialize authentication identifiers or email.
- Add a structural regression proving the entire
  `src/app/api/auth/debug` route directory remains absent.

The canonical authenticated `/api/auth/whoami` endpoint remains unchanged. It
returns 401 to signed-out callers and supplies only the minimal authenticated
identity state needed by product clients.

## Safety and closure

This is a reversible source-only removal. It changes no schema, credential,
session, production row, storage object, or provider configuration.

After merge and deployment, closure requires an unauthenticated production
request proving `/api/auth/debug` returns 404 with no diagnostic JSON, followed
by a clean runtime-log check.
