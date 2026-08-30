# Canonical credit memo query truthfulness

Date: 2026-08-29  
Product boundary: Buddy The Underwriter only

## Evidence

The canonical credit memo builder loaded the underwriting subject, spreads, loan
request, locked pricing, document checklist, pricing decision, AR evidence,
borrower identity, ownership, risk output, structural pricing, financial facts,
overrides, management, borrower narrative, personal income, existing debt, and
business-age evidence. Most result objects were consumed without inspecting the
Supabase error channel. The spread query explicitly converted an error to an
empty array.

A database outage or policy/schema failure could therefore produce a complete
memo with missing evidence presented as absence rather than make generation
fail. That breaks the evidence boundary for underwriting outputs.

## Root cause

Parallel read aggregation treated Supabase result objects as data-only values.
The outer builder already had a deterministic failure result, but query errors
were discarded before they could reach it.

## Repair

- Add one deterministic query-proof guard that never exposes provider details.
- Require success for all 19 authoritative reads in the two core aggregation
  groups and for spread discovery.
- Keep a successful empty result distinct from a failed read.
- Prove each parallel group before any result data is consumed.
- Add structural regression coverage for the complete guarded source set.

## Safety

This is a read-path fail-closed change. It does not change schema, production
data, storage, providers, dependencies, or credentials. It is independent of
the open memo-input-package, signing, storage, nightly-worker, and upload PRs.

## Production closure

After merge and deployment, exercise an authorized canonical memo build with a
controlled read failure and prove it returns
`canonical_memo_query_failed:<source>` without producing or submitting a memo.
A successful empty optional source must continue to build normally.

PR 878's complete Golden Trident seal-to-marketplace-to-lender transaction
remains blocked on a verified Buddy-owned Supabase connection and authorized
sealed fixture.
