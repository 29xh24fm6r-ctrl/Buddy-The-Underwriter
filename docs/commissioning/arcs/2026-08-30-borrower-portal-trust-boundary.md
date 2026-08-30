# Borrower portal trust boundary — 2026-08-30

## Evidence

- Portal link creation accepted unbounded expiry, label, channel, and identifier input.
- Link and SMS failures returned raw database or provider messages.
- SMS issuance did not persist the deal's authoritative bank on the bearer link.
- Phone-link or SMS failures could leave an active portal bearer token behind.
- Provider acceptance without durable delivery audit could be reported as an ordinary failure with no reconciliation signal.
- Portal session audit writes and all authoritative state reads ignored database errors, allowing a successful empty or incomplete borrower experience.
- Borrower messages accepted unbounded caller text and did not require returned-row persistence proof.

## Repair

- Centralize bounded portal identifiers, link parameters, tokens, messages, authors, trusted origins, and no-store behavior.
- Derive bank identity only from authenticated deal access and verify the returned link row exactly.
- Revoke undispatched bearer links when phone mapping, suppression, consent, or provider dispatch fails.
- Preserve accepted-but-unproven deliveries for reconciliation and return HTTP 503.
- Require exact portal-session audit persistence and every authoritative deal/checklist/request/message/spread read before success.
- Require exact borrower-message persistence proof.
- Return bounded operational errors and identifier-free logs.

## Validation

- Pure request-boundary and route-contract tests: 2 passed, 0 failed.
- Complete diff, CI, preview deployment, runtime logs, and production baseline are recorded in the PR.
- No database, schema, policy, provider configuration, credential, production row, or storage object was changed.

## Closure

After merge, use an authorized borrower sandbox fixture against the verified Buddy-owned Supabase project to prove link issuance, SMS failure revocation, accepted-but-unproven reconciliation, complete session reads, and message persistence.
