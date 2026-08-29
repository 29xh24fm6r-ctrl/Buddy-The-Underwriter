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

Focused and broad validation, complete diff inspection, exact-head CI, and
SHA-matched Vercel preview verification are pending.
