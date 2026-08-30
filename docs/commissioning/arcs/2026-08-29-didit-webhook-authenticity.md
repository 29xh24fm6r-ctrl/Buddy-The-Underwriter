# Didit webhook authenticity and replay integrity — 2026-08-29

## Scope

Buddy The Underwriter's production-owned Didit identity webhook path only:

- `src/app/api/webhooks/[vendor]/route.ts`
- `src/lib/identity/kyc/verifyDiditWebhook.ts`
- `src/lib/identity/kyc/__tests__/verifyDiditWebhook.test.ts`

No production data was mutated.

## Evidence-backed finding

The deployed verifier did not read Didit's recommended `X-Signature-V2` header. It accepted the legacy raw-body signature and explicitly accepted that signature when `X-Timestamp` was missing. A valid captured delivery could therefore be replayed indefinitely, and a destination configured to use V2 could reject authentic completions.

Didit's current authoritative webhook contract says:

- every delivery includes `X-Timestamp`;
- receivers must reject a timestamp more than 300 seconds from their clock;
- `X-Signature-V2` is the recommended full-body scheme;
- verification order is V2, exact raw body, then envelope-only Simple;
- the timestamp window applies to every accepted scheme.

Source: https://docs.didit.me/integration/webhooks

## Root cause

The verifier encoded an earlier assumption that timestamp omission was acceptable and modeled only two signature schemes. The route consequently omitted `X-Signature-V2` entirely. Replay freshness and authenticity were not treated as one admission decision.

## Repair

- Require a present, integer, safe `X-Timestamp` for every signature scheme.
- Enforce the inclusive five-minute freshness boundary before accepting any HMAC.
- Verify recursively sorted, compact, Unicode-preserving V2 canonical JSON first.
- Retain exact raw-body HMAC as the second full-body path.
- Retain Simple only as a compatibility fallback; downstream continues to re-fetch canonical Didit session state rather than trusting decision data authenticated only by Simple.
- Log whether the V2 header was present without logging signatures or payload data.
- Return deterministic reasons for missing, malformed, expired, or mismatched evidence.

## Regression coverage

The focused suite covers:

- V2 nested canonicalization, Unicode, empty objects, and array order;
- exact raw-body verification;
- Simple envelope fallback;
- missing timestamps for V2 and raw-body signatures;
- malformed and unsafe timestamps;
- stale replays and the exact 300-second boundary;
- forged, tampered, prefixed, uppercase, and non-hex signatures;
- diagnostic header evidence.

## Reconciliation and exact-head validation

PR 990 was reconciled onto current `main` with a merge commit that retained every
intervening Buddy The Underwriter repair. The conflict was limited to the shared
commissioning ledger; the Didit runtime and test files did not overlap.

Code head `f3baea0d58800c23c7430170b1a3e233825325a4`:

- 13,623 tests: 13,614 passed, 0 failed, 9 skipped.
- React-server passed 18/18; research evaluation passed 7/7 with 13 controlled
  placeholders explicitly skipped.
- Typecheck, lint, architecture, safety, legacy-write, polling, Never-500,
  schema-select, report-only schema drift, Build Check, Secret Scan, Route
  Budget, and public Playwright passed.
- Public Playwright passed its public crawl and skipped five fixture-dependent
  authenticated cases.
- The complete five-file diff was inspected: 315 additions and 158 deletions,
  with no conflicts, credentials, cross-product scope, or unexpected files.
- The exact-head Vercel preview was READY and SHA-matched.
- PR 990 was mergeable and zero commits behind `main`.

This evidence-file update is documentation-only. Its resulting exact head must
retain all required green checks and a READY, SHA-matched preview before handoff.

## Production verification

The currently deployed production build remained HTTP 200 and runtime-clean before this repair. Post-merge closure requires an authorized Didit sandbox delivery through the production-owned destination, with:

1. a valid V2 delivery accepted;
2. a stale signed delivery rejected;
3. the canonical identity status persisted;
4. no duplicate audit transition on provider retry.

## Unresolved risks and next target

- Transactional `event_id` deduplication requires verified production schema evidence before introducing a durable claim primitive.
- Golden Trident seal-to-marketplace-to-lender transactional proof still requires the verified product-owned database connection and an authorized sealed fixture.
