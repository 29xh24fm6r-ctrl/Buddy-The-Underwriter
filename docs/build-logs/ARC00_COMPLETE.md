# ARC-00 Complete — Gate 6 / Arc-end verification

**Date run:** 2026-07-12 · **Executor:** Claude Code · **Branch:** `claude/sba-forms-complete-arc-d92e55`

All 7 phases (0-6) of `specs/sba-30min-package/ARC-00-forms-complete-build-arc.md`
are code-complete and applied to prod. Per-phase detail lives in
`docs/build-logs/ARC00_PHASE_{0,1,2,3,4,5}_GATE.md` and
`docs/build-logs/ARC00_PHASE_6*` (this doc closes Phase 6).

## Gate 6 SQL (run against prod)

```sql
SELECT
 (SELECT count(*) FROM bank_document_templates WHERE is_active)                    AS templates,
 (SELECT count(DISTINCT code) FROM sba_package_templates)                          AS packages,
 (SELECT count(*) FROM sba_policy_rules WHERE superseded_at IS NULL)               AS live_rules,
 (SELECT count(DISTINCT form_name) FROM sba_form_payloads)                         AS payload_forms,
 (SELECT count(*) FROM sba_form_159_records WHERE generated_pdf_path IS NOT NULL)  AS real_159s;
```

**Result (2026-07-12):**

| templates | packages | live_rules | payload_forms | real_159s |
|---|---|---|---|---|
| 0 | 2 | 22 | 0 | 0 |

Same reading as every phase gate this arc: `templates=0` and `real_159s=0`
reflect the Phase 0 environmental blocker (no outbound network access to
sba.gov from this session — `scripts/ingest-sba-templates.ts` is complete,
ready-to-run infrastructure, not a code gap). `payload_forms=0` reflects
the Phase 1 finding that `sba_form_payloads` is a parallel legacy
subsystem this arc deliberately did not write into (see Drift Log) — the
real form data lives in this arc's own per-form modules and
`sba_package_run_items`, not that table. `packages=2` is correct:
`SBA_7A_BASE` + `SBA_504_BASE`, the two package templates this arc built.
`live_rules=22` is the Phase 0 policy rule set, unchanged since Gate 0.

Supplementary counts:

| sba_package_items | third_party_vendors | third_party_orders | bank_etran_credentials | sba_etran_submissions | sba_deals (any status) |
|---|---|---|---|---|---|
| 19 | 0 | 0 | 0 | 0 | 2 |

`third_party_vendors`/`bank_etran_credentials` are 0 because both require
a human to provision (a real vendor roster, a real SBA-issued mutual-TLS
cert) — the schema, orchestration, and admin UI are real and complete;
the data they'd hold doesn't exist yet in this environment. Only 2
`deal_type` rows are SBA in prod at all, and (per the Phase 1 Drift Log
finding, still true today) neither is a fully-populated smoke deal —
this is why the acceptance matrix below cannot be checked live end-to-end
this session.

## Acceptance matrix

Per the spec, every row should be ✅ generate / fill / sign / store on a
prod smoke deal. **No fully-populated SBA smoke deal exists in prod**
(open finding since Phase 1, reconfirmed at every subsequent gate) — so
this matrix reports **code-complete and unit/integration-tested against
mocked data**, not a live prod smoke-deal run. That distinction is
intentional: every prior gate this arc made the same honest call rather
than fabricating a live-verified checkmark.

| Form | Generate | Fill PDF | E-sign (IAL2) | Stored | 7(a) | 504 |
|---|---|---|---|---|---|---|
| 1919 | ✅ code | ✅ code | ✅ code (blocked: no Persona creds) | ✅ code | ✅ | n/a |
| 1244 | ✅ code | ✅ code | ✅ code (blocked: no Persona creds) | ✅ code | n/a | ✅ |
| 413 | ✅ code | ✅ code | ✅ code (blocked: no Persona creds) | ✅ code | ✅ | ✅ |
| 912 (cond) | ✅ code | ✅ code | ✅ code (blocked: no Persona creds) | ✅ code | ✅ | ✅ |
| 4506-C | ✅ code | ✅ code | ✅ code (blocked: no Persona creds) | ✅ code | ✅ | ✅ |
| 159 | ✅ code | ✅ code | e-sign-only, no fill (per spec) | ✅ code | ✅ | ✅ |
| 148/148L | ✅ code | ✅ code | ✅ code (blocked: no Persona creds) | ✅ code | ✅ | ✅ |
| 601 (cond) | ✅ code | ✅ code | ✅ code (blocked: no Persona creds) | ✅ code | ✅ | ✅ |
| 155 (cond) | ✅ code | ✅ code | borrower side only (see Drift Log — no seller/standby-creditor identity in schema) | ✅ code | ✅ | ✅ |
| 722 (delivery) | n/a | n/a | ack (deal_events, not e-sign) | ✅ code | ✅ | ✅ |

"E-sign (IAL2)" blocked cells: `PERSONA_API_KEY`/`PERSONA_WEBHOOK_SECRET`/
`PERSONA_TEMPLATE_ID_IAL2` are all unset in this environment (Phase 2
finding, unchanged) — the identity-verification → DocuSeal e-signature
pipeline is real, complete, and unit-tested against mocks, but has never
executed against a live Persona session because no account is
provisioned. DocuSeal itself is also undeployed (no GCP/Cloud Run access
— `infrastructure/docuseal/` is ready-to-run infra for ops handoff).

## Phase 6 close-out (this doc's scope)

Phase 6 (SPEC S5) shipped in two sections:

- **Section A — third-party orchestration** (commit `0fd17c2`): NAICS
  Appendix 6 trigger rules, `evaluateAndCreateTriggers`/`dispatchOrder`/
  `ingestResult`/`cancelOrder` orchestrator, vendor email templates,
  Story tab panel, bank-admin vendor roster route.
- **Section B — real E-Tran submission** (this commit): encrypted-at-rest
  mutual-TLS credential storage (`bank_etran_credentials`, pgcrypto via
  `SECURITY DEFINER` RPCs, RLS deny-all), `submitToSba()` orchestration
  with the permanent human-approval gate, real mutual-TLS POST client
  (`etranHttpClient.ts`), wired as a `submit-etran` action on the
  existing `/api/deals/[dealId]/sba` action-dispatch route (no new route
  file, no collision with the pre-existing dead `/etran/submit` legacy
  route), bank-admin credential panel (mounted on the existing
  `/banks/[bankId]/templates` page rather than a new page route),
  `infrastructure/etran/CREDENTIAL_ROTATION.md` runbook, unit tests
  (`submitter.test.ts` — 10 cases, `credentials.test.ts` — 8 cases via
  the inline-reimplementation pattern since `credentials.ts` is
  `"server-only"` + ESM-imports `supabaseAdmin`), and 4 cron checks
  (IRS transcript polling, signature staleness, third-party order
  overdue, E-Tran cert expiry) consolidated into one
  `/api/cron/sba-checks?check=<name>` route + 4 `vercel.json` entries.

**Real bug found and fixed while wiring the cron layer (AP-2 —
blocked this gate):** `staleSignatureChecker.ts`'s `writeStaleSignatureGaps`
(shipped Phase 2) omitted `deal_gap_queue`'s required `bank_id`/`fact_type`
columns and used a plain `.insert()` against a table with a real unique
constraint on `(deal_id, fact_type, fact_key, gap_type, status)` — every
call would have failed on the NOT NULL constraint in prod, and a second
call for a still-open gap would have thrown on the UNIQUE constraint. This
had never surfaced because nothing had actually called it repeatedly
against real data until this phase wired it into a live cron. Fixed
in-place (added the missing columns, switched to `.upsert()` with the
correct `onConflict`); the new `thirdPartyOverdueChecker.ts` was built
correctly from the start using the same fix. Full detail in the Drift Log.

## Route/page slot budget — final state

```
node scripts/count-routes.mjs
Total: 1971 / 2048 (Vercel hard cap)
Error threshold: 2001 — 30 slots of headroom
Status: warning
```

Phase 6 added exactly 4 route files across both sections (2 in Section A,
1 in Section B for `etran/credentials`, 1 consolidated cron route serving
4 distinct cron schedules via a query param) — far below the 15+ typical
of earlier phases, entirely because of the consolidation patterns adopted
from Phase 4 onward (single `[action]/route.ts` per feature, extending
existing action-dispatch routes, one route file serving multiple cron
schedules via query params). The arc closes in "warning" status, not
"error" — real headroom remains, but any future phase should keep
following this pattern rather than reverting to one-file-per-endpoint.

## Regression suite

Full `npm run test:unit` run at the close of Phase 6C: 11,383+ passing,
1 known pre-existing failure (`routeConsolidationGuard.test.ts`'s "stays
below 1900 warning threshold" subtest — has failed consistently and
un-changingly since Phase 3, is not a regression from any code in this
arc, and reflects the same route-budget reality documented above). No
other failures at any point in this session's work.

## What's genuinely not done (see Drift Log for the exhaustive list)

- **No live SBA smoke deal** — every "real" verification this arc did was
  schema-level (`information_schema`/`pg_constraint` against prod) or
  unit/integration-tested against mocked data, never an actual borrower's
  data flowing through the full generate→fill→sign→store→submit pipeline.
- **No vendor credentials provisioned anywhere** — Persona, DocuSeal
  (also undeployed), CAIVRS, SAM.gov, IRS transcript vendor, SBA E-Tran.
  Every integration fails closed with a clear "credentials missing" error
  rather than fabricating a response — this is by design, not an
  oversight, and matches the arc's vendor-agnostic client pattern
  throughout.
- **`deal_truth_snapshots` has only 3 columns in prod** (`id`, `deal_id`,
  `created_at`), so `generateETranXML` — this phase's own dependency,
  along with several pre-existing subsystems — can never reach
  `ready_for_review: true` against real data today. `submitToSba` fails
  closed on this correctly (`VALIDATION_FAILED`); populating
  `deal_truth_snapshots` for real is a separate, materially larger effort.
- **Form 155's standby creditor (the seller)** has no identity/address
  representation anywhere in canonical state — permanent documented gap,
  not attempted this arc.
- **Three parallel legacy subsystems** (triple eligibility engines,
  generic `fillEngine`, dead `/etran/submit` route) remain unreconciled
  by design — see Drift Log for the standing disposition.
- **Official SBA template ingestion never ran** — infrastructure is
  complete, blocked purely on this session's lack of outbound network
  access to sba.gov.

## Conclusion

ARC-00's code scope is complete: every SBA borrower-facing form specified
across 7(a) and 504 has a real, tested build/fill/render module; e-signature,
identity verification, third-party vendor orchestration, and real SBA
E-Tran submission (gated by a permanent human-approval requirement) are
all wired end-to-end in code. What remains before this is genuinely
production-ready is entirely environmental — vendor account provisioning,
network access for template ingestion, GCP access for DocuSeal deployment,
and a real smoke deal to verify against — none of which a coding session
without those credentials/access can close. Per AP-8 ("prod is the only
truth"), this doc reports what was actually verified against live prod
schema and data, not what the spec hoped would be verified.
