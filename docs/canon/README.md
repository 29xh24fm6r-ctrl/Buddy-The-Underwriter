# Buddy Canon (Source of Truth)

This folder contains the invariants Buddy must obey. If something conflicts with the canon, the canon wins.

## Canonical primitives
- **Tenant**: Every read/write is scoped by `bank_id` (or enforced via RLS + server-side guardrails).
- **Ledger**: One canonical event ledger table for pipeline runs + notable system events.
- **Checklist Engine**: Deterministic rules decide status; AI only annotates/explains.
- **Uploads**: Never rely on filenames. Classification comes from document content and metadata.

## What goes where
- `docs/canon/` = rules, invariants, contracts, schemas, operational truths
- `docs/build-logs/` = historical implementation notes, shipped summaries, PR completion logs
