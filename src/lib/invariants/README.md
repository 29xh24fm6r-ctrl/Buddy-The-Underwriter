# Invariants

This folder contains lightweight guardrails that prevent architectural drift.

Examples:

* Multi-tenancy must be enforced (bank_id scoping / RLS).
* Pipeline actions must write to the canonical ledger.
* Upload writers must call the doc-matching/engine stamping path.
