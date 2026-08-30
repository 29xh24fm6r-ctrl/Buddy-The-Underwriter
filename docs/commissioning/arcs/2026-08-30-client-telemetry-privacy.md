# Client telemetry privacy and authenticity — 2026-08-30

## Scope

Buddy The Underwriter's upload client and `/api/debug/client-telemetry`
observability boundary only. No other product, schema, credential, provider
configuration, or production data is changed.

## Evidence and root cause

- The telemetry route was public and accepted arbitrary JSON.
- It logged caller-controlled messages, nested metadata, host, referrer, and user
  agent without authentication, field allowlisting, or a payload-size bound.
- The canonical upload client sent deal ids, filenames, MIME types, document ids,
  object paths, and raw error details into that public log path.
- The response reported HTTP 200 even when parsing or processing failed.

This allowed unauthenticated log injection and made borrower/document identifiers
and free-form errors eligible for retention in production runtime logs.

## Repair

- Require a bounded Clerk session and distinguish unavailable authentication from
  an unauthenticated caller.
- Enforce an 8 KiB body ceiling and reject malformed payloads.
- Share one sanitizer between the browser emitter and server boundary.
- Retain only bounded request/stage tokens and allowlisted scalar delivery state.
- Exclude deal ids, document ids, filenames, object paths, MIME types, messages,
  raw errors, nested metadata, and request fingerprinting headers.
- Return truthful 400, 401, 413, or 503 outcomes; accept valid events with 202.
- Add behavior and cross-boundary regression coverage.

## Verification and closure

Focused and broad tests, required CI, complete-diff inspection, and exact-head
preview evidence are recorded on the pull request. After merge, production
closure requires an authorized upload attempt proving accepted sanitized
telemetry without sensitive fields in runtime logs.
