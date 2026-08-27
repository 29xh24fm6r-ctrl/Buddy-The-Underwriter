# Nightly policy governance persistence convergence — 2026-08-27

Scope: Buddy The Underwriter production only.

## Evidence and root cause

- Policy-rule reads, final-decision reads, drift-finding inserts, drift-finding
  reads, and policy-suggestion inserts discarded Supabase errors.
- AI suggestion failures were logged and swallowed, so nightly governance could
  report completion without authoritative inputs or durable evidence.
- The schema-shaped no-key AI fallback could be accepted even though its
  suggestion fields were objects rather than non-empty text.

## Repair

- Fail closed on every authoritative read and evidence write.
- Attempt independent findings and suggestion rules before aggregating failure.
- Return explicit evaluated, generated, and persisted evidence counts.
- Validate AI suggestion shape before persistence.
- Lazy-load production database and provider dependencies for isolated tests.

## Safety and dependencies

- No schema, migration, credential, provider configuration, or production-data
  changes are included.
- This arc does not modify PR 921's route or retention files.
- Database verification remains quarantined until the connected Supabase
  project is unambiguously Buddy-owned.
- Production AI governance remains blocked by PR 917's unapplied migration;
  applying it requires the verified Buddy-owned project connection.
