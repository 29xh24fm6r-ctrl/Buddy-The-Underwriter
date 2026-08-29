# Plaid webhook and transaction-sync truthfulness

Date: 2026-08-29
Product: Buddy The Underwriter / www.buddysba.com

## Evidence and root cause

The verified Plaid webhook route acknowledged deliveries even when authoritative
database work was not proven:

- connection lookup discarded Supabase errors and treated an unavailable read as
  an intentionally untracked Item;
- both transaction webhook paths returned `ok: true` when
  `syncTransactions` returned `ok: false`;
- Item error, expiration, and revocation updates ignored database errors and
  zero-row writes;
- transaction sync ignored account upsert/read errors, silently dropped
  transactions whose account mapping was missing, ignored transaction
  upsert/delete failures, and advanced the Plaid cursor without returned-row
  proof.

Advancing the cursor after any of those failures permanently skips the affected
Plaid delta. A successful HTTP acknowledgement also tells Plaid that retry is
unnecessary.

## Repair

- Fail closed on unavailable connection state while preserving the legitimate
  ignored response for a proven missing Item.
- Return HTTP 503 for failed transaction synchronization so Plaid retains
  retryable failure evidence.
- Require returned-row and requested-status proof for Item lifecycle writes.
- Check every account, transaction, removal, and cursor database operation.
- Reject missing transaction-to-account mappings instead of filtering them out.
- Advance the cursor only after every page mutation succeeds and the persisted
  cursor is returned exactly.
- Preserve sync failure evidence without allowing failure-evidence persistence
  itself to convert the cycle into success.
- Add structural regression coverage for the complete webhook-to-cursor
  contract.

## Scope and safety

Buddy The Underwriter only. No schema, dependency, credential, production-data,
or destructive storage change. Transaction removals remain limited to the exact
Plaid IDs supplied by a verified webhook and now fail closed on persistence
errors.

## Verification

Validation on code head `c4dc18b0f70039c29867091486ff6ae7d8add5da`:

- 13,532 tests: 13,523 passed, 0 failed, 9 skipped.
- React-server: 18/18; research evaluation: 7 passed, 0 failed.
- Typecheck, lint, architecture, safety, schema-select, report-only drift,
  Never-500, Build Check, Secret Scan, Route Budget, and public Playwright
  passed.
- The complete five-file diff was inspected: +299/-18 with no schema,
  dependency, credential, production-data, or cross-product change.
- Exact-head Vercel preview `dpl_5uUPDjUwUTNHGtVnPgHwXEVVHVPr` is READY,
  SHA-matched, HTTP 200, and has no warning/error/fatal logs or grouped runtime
  errors in the two-hour verification window.

This evidence-only documentation update changes no runtime code. Its final head
must retain green required checks and a READY, SHA-matched preview before merge
recommendation.
