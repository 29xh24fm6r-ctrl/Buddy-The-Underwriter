# Finengine Rollback Playbook

> SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 27

Every cutover is instantly reversible. Rollback never requires a deploy of new
logic — only a flag change.

## Product path rollback

- Set the product's flag back to `false` in `ProductCutoverFlagMap` (or call
  `rollbackCiTermDscr()` for the C&I DSCR candidate, which returns the all-false
  map). `resolveProductCutover` immediately routes back to legacy.
- No data migration is needed: legacy facts were never superseded (the
  certification writer supersedes only prior finengine certs).

## Certified-write rollback

- Disable the writer: unset `FINENGINE_CERTIFICATION_WRITER_ENABLED`.
- To revert already-written certified facts, the caller uses the
  `writtenKeys` returned by `persistCertifiedFinengineFacts` as the rollback set
  (the writer runs inside the caller's transaction; the caller owns commit/abort).

## GCF circular writer rollback

- To restore the circular writer after quarantine, unset
  `GCF_CIRCULAR_WRITER_DISABLED` (default is enabled). Behavior returns to the
  pre-PR-19 state exactly.

## Safety notes

- Because legacy is the default and finengine writes are gated + superseding only
  their own prior certs, rollback cannot corrupt legacy facts.
- The burn-down ledger keeps every producer `deletionEligible: false` until the
  final human-approved burn-down, so no rollback path is ever removed prematurely.
