# Borrower Intake Progress Transaction Truthfulness — 2026-08-28

## Scope

Buddy The Underwriter only: the public borrower `/start` workspace, `/api/borrower/intake/progress`, canonical chapter facts, resume-pointer persistence, production deployment health, and CI.

## Evidence and root causes

1. `ensureConciergeSession` treated failed existence and deal reads as missing rows and did not inspect the insert result.
2. Chapter 1–4 canonical reads and writes awaited Supabase envelopes without inspecting `.error`; the surrounding `try/catch` therefore did not catch database failures.
3. The route could persist `borrower_intake_progress.current_chapter` and return `ok: true` after a canonical fact write failed.
4. GET could return a fresh-looking workspace when canonical fact or completion hydration was unavailable, and POST still advanced progress after degraded completion reads.
5. Progress used read-increment-upsert, allowing concurrent tabs to overwrite the same version.
6. The client treated failed hydration as completed hydration, exposed chapter 1, and allowed a later save to move the resume pointer.
7. A connected Supabase project could not be verified as Buddy-owned, so no database was queried or modified.

## Repair

- Prove concierge-session existence, deal ownership lookup, and inserted-row persistence.
- Centralize canonical fact reads/writes with explicit errors, optimistic `updated_at` guards, and returned-row proof.
- Prove the financing deal update.
- Refuse both initial hydration and progress advancement when canonical fact or completion evidence is degraded.
- Replace read-increment-upsert with optimistic version guards and returned-row proof.
- Keep the borrower workspace blocked when hydration fails and provide an explicit retry.
- Reject session/deal hydration mismatches.
- Add source-level regression coverage for the complete transaction boundary.

## Verification plan

- Run focused borrower transaction guards.
- Run the complete unit, React-server, research, schema, safety, architecture, Never-500, and browser suites.
- Inspect the complete diff.
- Require a READY, HTTP-200, exact-head preview with clean runtime logs.
- Reverify deployed production after any observed merge.

## Dependencies and closure

- PR 961 remains an independent merge checkpoint for public document-link uploads.
- After this repair merges, run an authorized resume/save fixture across chapters 1–5 and verify canonical facts, version monotonicity, retry behavior, and the final resume pointer in the verified Buddy-owned Supabase project.
- PR 878's seal-to-marketplace-to-lender transactional ceremony still requires the verified Buddy connection and an authorized transaction.
