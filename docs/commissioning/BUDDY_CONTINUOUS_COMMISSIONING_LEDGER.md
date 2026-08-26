# Buddy Continuous Commissioning Ledger

Scope: `29xh24fm6r-ctrl/Buddy-The-Underwriter` and the infrastructure that serves
`www.buddysba.com` only. Buddy LOS and every other LOS/CRM product are explicitly
out of scope.

## 2026-08-26

### Production baseline and merged repair verification

- PR 878 merged to `main` at `df740f97ebe007a553b2fcfa6811e9a7c6fa0df6`.
- Vercel production deployment reached `READY`; the authenticated Golden Trident
  admin surface reported commit `df740f9` and all three AI providers ready.
- No new fatal/error runtime events appeared during the two-hour post-deploy
  observation window.
- The complete authenticated seal -> marketplace -> lender-delivery mutation is
  not yet closed: executing it transmits live borrower data to external AI
  providers. It requires an explicitly authorized live QA transaction.
- Production database row verification is also open because the Buddy Supabase
  connector returned an internal connection error. No database health claim was
  inferred from source alone.

### Open merge checkpoint: PR 879

- Head: `8d4dcb3e5d42e4c27ec7aaf92392f9212ab9c830`.
- State: mergeable; CI, Build Check, Secret Scan, route budget, and Vercel preview
  all green.
- Repairs: preview redaction provenance persistence, revoked borrower-link
  enforcement, required feasibility narrative keying, and activation of fourteen
  previously skipped server-only regression tests.
- Production verification remains dependent on Matt merging PR 879.

### Identity reconciliation incident and repair

Evidence:

- Vercel recorded three Didit follow-up 404s on 2026-08-25 for
  `GET /v3/session/{sessionId}/`.
- Didit's current v3 contract exposes canonical retrieval at
  `GET /v3/session/{sessionId}/decision/`.
- Buddy's webhook and fallback reconciliation both called the unsupported endpoint,
  so a completed borrower could remain stranded behind the identity/sealing gate.
- Successful reconciliation also performed a redundant second decision request.

Repair branch: `fix/didit-decision-reconciliation`.

Repair:

- The compatibility status-fetch boundary now delegates to the supported decision
  resource.
- Webhook and fallback reconciliation consume one canonical vendor response and no
  longer issue a duplicate GET after approval.
- The service contract accepts the decision response shape instead of requiring
  creation-only `workflow_id` and `url` fields.
- Added an endpoint contract guard and an orchestration regression proving exactly
  one vendor read and a persisted approved/completed result.
- No schema change, dependency change, or production mutation.

Verification status: awaiting PR CI and preview deployment.

### Highest-value next independent targets

1. Diagnose the observed Golden Trident seal-status 30-second timeout using route,
   database-query, and runtime evidence.
2. Diagnose the independent `/api/buddy/signals/latest` timeout.
3. Re-establish Buddy Supabase connector access, then verify identity rows, sealed
   packages, full Trident bundles, and artifact provenance directly.
4. After PR 879 merges, verify revoked-link denial and redaction provenance in
   deployed production.
5. With explicit authorization for a live QA mutation, execute and evidence the
   production seal -> marketplace -> lender-delivery chain.
