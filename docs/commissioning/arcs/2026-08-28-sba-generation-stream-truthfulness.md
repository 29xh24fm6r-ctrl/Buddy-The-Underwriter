# SBA generation stream truthfulness

Date: 2026-08-28
Repository: `29xh24fm6r-ctrl/Buddy-The-Underwriter`
Production baseline: `fe428208311739a0147294d10c1e2d3d4d1ceb2b`

## Production closure carried forward

PR 963 is merged and deployed. The production domain returns HTTP 200 with the
exact baseline SHA and no warning, error, or fatal runtime logs in the
post-deployment window. Transactional assumption confirmation still requires an
authorized SBA fixture for direct database proof.

## Evidence and root cause

The SBA package client treated every response body as a Server-Sent Events
stream. A JSON authentication, validation, or server error still has a readable
body, so it bypassed the existing `!res.body` check. The parser then ignored the
JSON as a malformed SSE frame and reached end-of-stream without clearing the
generation overlay or surfacing the failure.

The same indefinite overlay occurred when an SSE connection closed without a
terminal `complete` or `error` event. A server or intermediary that kept the
connection open indefinitely had no client deadline.

## Repair

- Require both HTTP success and an SSE content type before reading frames.
- Extract safe error or blocker evidence from JSON responses.
- Parse CRLF and canonical SSE data frames through a tested shared helper.
- Require a terminal `complete` or `error` event.
- Convert premature EOF into an explicit retryable failure.
- Abort generation after a bounded three-minute deadline.
- Cancel the reader once a terminal event arrives.
- Keep completion dismissal behavior while guaranteeing every other exit clears
  the blocking overlay.

## Regression coverage

Behavioral tests cover canonical and CRLF frames, comments, malformed and
structurally invalid frames, JSON blocker extraction, and safe HTML fallback.
A source-contract test guards HTTP/content-type checks, terminal-event proof,
premature-EOF failure, timeout cancellation, and reader cancellation.

## Remaining production proof

After merge, an authorized SBA fixture is required to exercise successful
generation plus controlled JSON-error, premature-EOF, and timeout probes.
Golden Trident seal-to-marketplace-to-lender delivery remains blocked by a
verified Buddy-owned Supabase connection and an authorized transaction.

## Next target

Rotate into SBA package artifact retrieval and PDF persistence truthfulness,
unless production evidence identifies a higher-severity independent failure.
