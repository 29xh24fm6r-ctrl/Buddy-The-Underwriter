# Worker readiness service-auth convergence

Date: 2026-08-28  
Product boundary: Buddy The Underwriter only  
Repository baseline: `be5ee2a382a99711f1b987d833bc3a0b5f251cb3`

## Production evidence

- `www.buddysba.com` remained available on the baseline build.
- Production `/api/jobs/worker/tick` invocations emitted `not_authenticated`
  together with Clerk's missing-middleware diagnostic from a sessionless worker.
  The latest occurrence was 2026-08-28 03:36:17 UTC and included both
  `financial_facts_written` and `document_finalized` readiness triggers.
- The leased spreads job had already verified its `(deal_id, bank_id)` pair and
  issued an opaque service grant before scheduling unified readiness.
- After the canonical financial snapshot was persisted, the same processor
  called the legacy persisted-readiness writer without that grant.
- When the legacy writer found the deal not ready, it scheduled unified
  readiness without service context. That forced the background invocation
  through browser Clerk authorization and produced the observed errors.

## Root cause

The worker used two intentionally distinct readiness systems. Unified readiness
received a verified service grant, but the legacy projection that still owns
`deals.ready_at`, transition webhooks, regression events, brokerage lifecycle
notifications, and canonical lifecycle advancement did not accept or forward
service context. Its not-ready fallback therefore discarded the worker's
already-proven tenant ownership.

## Repair

- Retain the opaque deal/bank grant issued for the leased spreads job.
- Refuse to invoke the persisted-readiness writer when that grant is absent.
- Add an optional recomputation context carrying the system actor and opaque
  grant; existing browser callers remain source-compatible.
- Forward that context into the not-ready unified refresh so sessionless work
  never falls through to Clerk authorization.
- Let checklist reconciliation accept and forward the same context; its
  change-triggered `document_finalized` refresh was a second evidenced leak.
- Make confirmed-intake processing verify canonical deal/bank ownership before
  mutation and reuse that proof for checklist and final readiness triggers.
- Preserve the legacy writer and all of its transition, webhook, regression,
  communications, and lifecycle side effects.
- Strengthen the document-worker convergence guard to prohibit the ungranted
  worker call and prove end-to-end grant propagation.

## Validation evidence

- Focused sessionless-readiness and transition-helper service-context contracts
  passed before push.
- The first CI run correctly found a helper-scope TypeScript error. The repair
  made the verified readiness context an explicit required helper input; the
  replacement exact code head was `3d497b5fa15c1696af523f74b19966778171cf7f`.
- Full unit suite: 13,343 tests; 13,334 passed, 0 failed, 9 skipped.
- React-server suite: 18 passed, 0 failed.
- Research evaluation: 7 passed, 0 failed, 13 production-placeholder cases
  skipped and retained as an explicit coverage debt.
- Typecheck, lint, Next.js build, architectural guards, SPEC-13.5, safety
  invariants, schema select, Never-500, Secret Scan, and public Playwright all
  passed. Authenticated Playwright was explicitly skipped without credentials.
- Schema drift remained report-only: 1,732 blocking findings were emitted into
  the drift artifact and were not misrepresented as a clean database verdict.
- Public Playwright: 1 passed and 5 credential-dependent journey checks skipped.
- The six-file branch diff was inspected in full: 211 additions, 17 deletions,
  no schema, dependency, credential, environment, permission, or production-data
  changes.
- Exact code-head Vercel deployment `dpl_E4XcatnPrTgJ65dxoNPYGiKLmNQd` was
  READY and HTTP 200; `x-buddy-build` matched `3d497b5f...`, with no error/fatal
  preview logs and no runtime-error clusters in the verification window.
- Production remained HTTP 200 on `be5ee2a382a99711f1b987d833bc3a0b5f251cb3`.
  The evidenced worker defect remains active until this PR is merged and an
  authorized worker invocation proves the repaired path.

## Production closure

After merge:

1. verify the deployed production SHA and public health;
2. run or observe an authorized spreads worker job;
3. prove its persisted-readiness and not-ready fallback paths emit no Clerk
   `not_authenticated` or missing-middleware diagnostics;
4. verify readiness transition side effects still persist when the fixture
   crosses the canonical ready boundary.

## Continuing ledger

- PR 947 remains the independent committee authorization/truthfulness merge
  checkpoint.
- PR 948 remains the independent nightly tenant/retention convergence merge
  checkpoint; its production closure requires the next nightly invocation.
- PR 878's full Golden Trident seal-to-marketplace-to-lender ceremony still
  requires an authorized production-safe transaction and verified Buddy-owned
  Supabase access.
- Direct database verification remains blocked because the available Supabase
  connection identifies as another product and was not accessed.
- Authenticated document and committee fixtures, plus 13 production-backed
  research cases, remain outstanding.
- Next independent target: audit persisted-readiness database error handling so
  failed updates, pipeline evidence, and regression records cannot be reported
  as successful convergence.

No schema, dependency, credential, environment, permission, or production-data
mutation is part of this repair.
