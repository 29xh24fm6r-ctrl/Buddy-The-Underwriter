# Banker analysis alert evidence and delivery truthfulness

Date: 2026-08-29  
Scope: Buddy The Underwriter only

## Evidence

The Vercel-scheduled banker-analysis alert route reads Buddy's canonical
`risk_runs`, `deal_pipeline_ledger`, and `deal_events` evidence before
sending SLA alerts through the configured Slack incoming webhook.

Source review on production main `69ff673b7d57fda700ed0539263d40fecdec0df8`
proved four coupled integrity gaps:

1. All three authoritative Supabase reads discarded `error` values and
   substituted empty arrays, so an unavailable schema, policy, or database could
   generate an all-clear SLA result.
2. Each source stopped at a single `limit(5000)` query. A capped response was
   indistinguishable from complete evidence.
3. The 30-minute cooldown lookup discarded database errors and continued to
   Slack, allowing duplicate alerts when dedupe evidence was unavailable.
4. The Slack sender used `try/catch` around a Supabase insert but never checked
   the returned `error` or row. Provider acceptance was therefore reported as
   a successful delivery even when Buddy could not prove or deduplicate it.
   The cron route also counted every non-send as a harmless skip and always
   returned HTTP 200.

## Repair

- Page every authoritative SLA source in deterministic `created_at, id` order.
- Fail closed on every page error and on the explicit 50,000-row evidence cap.
- Refuse provider delivery when cooldown evidence is unavailable.
- Require the exact returned system-event id, kind, and alert identity after a
  Slack acceptance.
- Distinguish accepted-but-unproven provider delivery with
  `providerAccepted: true` and `evidence_persistence_failed`; never count it
  as sent.
- Reserve `skipped` for a proven cooldown and return HTTP 503 for configuration,
  read, provider, or persistence failures.
- Add behavioral regression coverage for source failure, multi-page evidence,
  cooldown failure, returned-row mismatch, persistence failure, proven success,
  and route status.

## Verification

- Broad unit suite: 13,625 tests; 13,616 passed, 0 failed, 9 skipped.
- React-server suite: 18/18; research golden set: 7 passed, 0 failed.
- CI, typecheck, lint, architecture, safety, schema gates, Never-500, Build
  Check, Secret Scan, Route Budget, and public Playwright passed.
- The exact-head Vercel preview is READY, HTTP 200, SHA-matched, and has no
  warning/error/fatal logs or grouped runtime errors.
- The complete seven-file diff was inspected: 498 additions, 60 deletions,
  no conflict markers, and no unexpected scope.

## Safety and closure

This repair changes no schema, dependency, credential, provider configuration,
production row, or other product. No Supabase project was queried because the
available connection is not verified as Buddy-owned.

After merge, closure requires an authorized alert fixture against the verified
Buddy-owned Supabase project and Slack sandbox: prove one send, one cooldown
suppression, one provider failure, and one persistence-failure response without
exposing raw database or webhook details.

The next independent scheduled-path audit is the document/spreads worker tick,
whose composite results must be checked for false-green partial work.
