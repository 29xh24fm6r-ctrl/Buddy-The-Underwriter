# QA click telemetry trust and privacy boundary — 2026-08-30

## Evidence

The globally mounted QA provider allowed any browser to enable capture through a
query parameter or local storage. The server then accepted a caller-supplied
`x-qa-mode: 1` header as authority. An authenticated caller could therefore
write arbitrary nested JSON to `qa_click_events`.

The browser payload also included full query strings, element text, hrefs,
classes, names, input types, labels, and DOM ids. Those fields can contain
borrower identity, deal/document identifiers, filenames, one-time tokens, and
other customer data. Database errors and unexpected exceptions were returned
verbatim.

## Root cause

QA enablement, payload validation, and persistence evidence were implemented as
independent conveniences instead of one trust boundary. Public client state was
treated as server authorization, and the database accepted the browser's
unbounded object without canonicalization.

## Repair

- Only the server-only `QA_MODE=1` flag authorizes capture.
- The client only enables capture when its deployment is explicitly built for QA;
  URL and local-storage overrides no longer enable it.
- Capture is restricted to authenticated users in the canonical sandbox tenant.
- Requests are capped at 8 KiB and share one client/server sanitizer.
- Query strings, fragments, free-form DOM fields, and identifier-shaped route
  segments are removed before transmission and again before persistence.
- Only the route, tag, `data-testid`, and `data-qa` operational tokens survive.
- Success requires exact returned-row proof; scope/read/write failures are
  deterministic, non-sensitive, and non-green.
- Responses are non-cacheable.

## Regression coverage

Behavioral coverage proves safe-field retention, identity redaction, query/token
removal, and malformed-input rejection. Cross-boundary guards prove the server
does not trust public flags or request headers and the browser cannot serialize
text, links, classes, or query strings.

## Production closure

No production data was queried or mutated. After merge, closure requires a
verified QA-enabled preview or production sandbox fixture proving one click
persists only the canonical safe shape and that a non-sandbox actor is denied.
