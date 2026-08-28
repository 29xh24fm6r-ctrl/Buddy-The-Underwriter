# SBA assumption confirmation truthfulness

Date: 2026-08-28
Repository: `29xh24fm6r-ctrl/Buddy-The-Underwriter`
Production baseline: `440c22eae8f2454c190f3e958dff92fe1c77fd50`

## Evidence

PR 962 is merged and deployed. The production domain returns HTTP 200, emits the
exact build SHA above, and showed no warning, error, or fatal runtime events in
the post-deployment window.

The assumption interview still had a separate fail-open boundary:

- Autosave ignored HTTP status and response bodies, then displayed `Saved`.
- Confirm and reopen changed local status before the server proved persistence.
- Confirmation accepted the coarse completion percentage without running the
  canonical assumption validator.
- The API persisted `confirmed` without loading and validating canonical state.
- Supabase upsert errors were checked, but a returned row was not required, so
  a zero-row or mismatched persistence outcome could still be reported as success.

The coarse completion calculation can report 100% while canonical blockers
remain, including an unnamed revenue stream or a management biography shorter
than the generation contract requires.

## Repair

- Validate allowed lifecycle statuses at the API boundary.
- Load the canonical assumption row and run `validateSBAAssumptions` before
  confirmation.
- Return blocker evidence with HTTP 422 and do not persist invalid confirmation.
- Require the Supabase upsert to return an identified row with the requested
  status.
- Clear `confirmed_at` when assumptions are reopened.
- Keep client status unchanged until the API proves persistence.
- Report autosave and lifecycle mutation failures visibly.
- Launch generation only after confirmed state is proven.
- Use canonical validation, not the completion meter, to enable confirmation.

## Regression coverage

`assumptionConfirmationTruthfulness.test.ts` proves that 100% completion can
still fail canonical validation, checks validation ordering before persistence,
checks returned-row proof, and guards the client against optimistic false
success.

## Remaining production proof

After merge and deployment, an authorized SBA assumption fixture is required to
prove both paths transactionally:

1. an invalid 100%-looking assumption set returns 422 without changing state;
2. a valid set persists `confirmed`, records `confirmed_at`, and only then
   begins package generation.

The full Golden Trident seal-to-marketplace-to-lender delivery ceremony remains
blocked on a verified Buddy-owned Supabase connection and an authorized
transaction. No unverified or non-Buddy database connection was accessed.

## Next independent target

Audit the SBA generation stream for truthful handling of non-streaming HTTP
errors and interrupted streams, then rotate to identity/signing callback
convergence if that path is already covered by an active independent PR.
