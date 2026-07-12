# ARC-00 Phase 2 Gate — SPEC S3 (IAL2 identity verification + DocuSeal e-signature)

**Date run:** 2026-07-12 · **Executor:** Claude Code · **Branch:** `claude/sba-forms-complete-arc-d92e55`

## PIV results

- **PIV-1** — S2 forms shipped: confirmed, `form1919/build.ts` and
  `form413/build.ts` exist (Phase 1).
- **PIV-2** — `bank_user_memberships` shape confirmed (`bank_id uuid,
  user_id uuid, role text`) — matches the RLS pattern used by every new
  table in this phase.
- **PIV-3** — Storage buckets before this phase: `deal-documents`,
  `deal-files`, `bank-documents`, `trident-bundles`, `borrower_uploads`.
  No `signed-documents` bucket — created by this phase's migration.
- **PIV-4** — **No `gcloud` CLI and no GCP credentials in this
  environment.** Per the spec addendum ("DocuSeal production deployment is
  out of executor scope unless GCP credentials available... acceptable:
  Dockerfile + cloudrun.yaml + README committed"), this blocks actual
  deployment only — `infrastructure/docuseal/` is complete and committed
  for ops handoff.
- **PIV-5** — **No `PERSONA_API_KEY`/`PERSONA_WEBHOOK_SECRET`/
  `PERSONA_TEMPLATE_ID_IAL2` configured.** Per the addendum ("if PIV-5
  reveals no Persona account → surface... block until Matt provisions"),
  this blocks live IAL2 verification (V-3d) only — all Persona
  client/service code is real and unit-tested.
- **PIV-6** — DocuSeal latest stable release confirmed via GitHub (network
  access to sba.gov/irs.gov/Docker Hub is blocked by this environment's
  proxy policy, same as prior phases; `github.com` is reachable):
  **3.1.3**, pinned in `infrastructure/docuseal/Dockerfile` and
  `cloudrun.yaml`.

## AP-3 schema-first finding

**The spec's own SQL for `idx_sd_expiring` doesn't apply — `NOW()` is not
IMMUTABLE.** `CREATE INDEX idx_sd_expiring ON signed_documents(expires_at)
WHERE expires_at > NOW()` fails at migration-apply time with `42P17:
functions in index predicate must be marked IMMUTABLE`. Fixed by indexing
the plain `expires_at` column and moving the "within N days" filter to
query time in `staleSignatureChecker.ts`, which is the only caller that
needs it. Documented inline in both the applied migration and the repo
file.

## What shipped

- **A.** `borrower_identity_verifications` table (migration
  `20260512`, applied cleanly — no drift this time). `src/lib/identity/kyc/`:
  `persona.ts` (real HTTP client, zod-validated), `service.ts`
  (`initiateKyc`/`handlePersonaWebhook`/`hasValidIal2`, kept free of
  "server-only" for testability — same pattern established in Phases 0–1),
  `verifyPersonaWebhook.ts` (HMAC-SHA256 `t=...,v1=...` verification per
  Persona's documented pattern). 3 API routes. 9 tests.
- **B.** `signed_documents` table + `signed-documents` storage bucket
  (migration `20260513`, fixed as above). `src/lib/esign/docuseal/`:
  `client.ts` (real HTTP client), `service.ts` — **the IAL2 hard gate
  lives here, at both `requestSignature` (request time) and
  `handleDocusealWebhook` (completion time, defense in depth) — neither
  gate was weakened or made conditional.** `verifyDocusealWebhook.ts`
  (HMAC-SHA256; the exact header/format is an documented assumption since
  no live DocuSeal instance exists to confirm against — flagged in the
  README for whoever deploys it). 3 API routes.
  `infrastructure/docuseal/{Dockerfile,cloudrun.yaml,README.md}` — complete
  deployment runbook including the AGPL-3.0 embed-as-service position, not
  yet deployed (PIV-4). 8 tests.
- **C.** `SbaSigningPanel.tsx` — per-owner-per-form IAL2/signature status
  table in the Story tab, with "Start ID verification" and "Send for
  signature" actions (the latter only enabled once IAL2 shows verified —
  mirrors the server-side gate so the UI doesn't invite a request that
  would just 403). A `signing-status` aggregation route was added (not
  separately named in the spec, but the panel needs owner + IAL2 + per-form
  status in one call — same judgment-boundary pattern S2's addendum used).
  S2's `SbaFormReadinessPanel` placeholder "Sign Form 1919" button (which
  was hardcoded disabled) was replaced with a pointer to this new panel.
  Wired into `StoryPanel.tsx` after `SbaFormReadinessPanel`.
- **D.** `src/lib/jobs/staleSignatureChecker.ts` — `findStaleSignatures`
  (14-day warning window) + `writeStaleSignatureGaps` (one `deal_gap_queue`
  row per finding). Cron deployment deferred per spec addendum — library
  function + 5 tests shipped, matching "mandatory" scope. `build.ts` for
  both 1919 and 413 extended with `expires_at`/`needs_resignature` on the
  `signature` type; new `buildForm1919WithSignature`/
  `buildForm413WithSignature` wrappers (kept separate from the pure
  `buildForm1919`/`buildForm413` per the spec's explicit split) look up
  real `signed_documents` rows. Both `/sba/forms/{1919,413}/build` routes
  now call the signature-aware wrapper.
- Integration test `src/__tests__/integration/sba-signing-flow.test.ts`:
  full happy path (initiate KYC → Persona webhook completes → request
  signature with IAL2 gate passing → DocuSeal webhook completes →
  `signed_documents` row exists with `identity_verification_id` populated)
  against mocked Persona/DocuSeal clients.

## Test count

37 tests across this phase's 5 new test files (kyc/service: 9, esign/
docuseal/service: 8, staleSignatureChecker: 5, form1919/form413 build:
14 unchanged + still passing after the signature type extension,
integration: 1) — 9+8+4+1(integration) meets the spec's stated minimums
(9/8/4/1), with 5 (not 4) on staleness and 14 pre-existing form tests
re-verified.

## Verification

```sql
-- V-3c
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('borrower_identity_verifications','signed_documents');
-- 2 ✅

SELECT id FROM storage.buckets WHERE id='signed-documents';
-- 1 row ✅
```

- **V-3a/b** (DocuSeal reachable, templates uploaded): **not run** — no
  deployment exists (PIV-4).
- **V-3d** (end-to-end IAL2, Persona sandbox): **not run** — no Persona
  account configured (PIV-5). Covered instead by 9 unit tests +
  integration test against mocked Persona responses.
- **V-3e** (end-to-end e-sign, DocuSeal): **not run** — no DocuSeal
  deployment. Covered instead by 8 unit tests + integration test against
  mocked DocuSeal responses.
- **V-3f** (IAL2 gate enforcement at request time): verified — unit test
  `requestSignature: no IAL2 -> IAL2_NOT_COMPLETED`.
- **V-3g** (defense-in-depth gate at webhook time): verified — unit test
  `handleDocusealWebhook: form.completed without IAL2 -> anomaly event + no
  signed_documents row`. The gate genuinely runs in both places; there is
  no code path that skips either check.
- **V-3h** (staleness logic): verified — 5 tests, 90d default staleness
  window in `signed_documents.staleness_window_days` and 90d/120d
  differentiation by `form_code` in the e-sign service tests.
- **V-3i** — `tsc --noEmit` clean (0 errors). `node --test`: 11240/11250
  passing, 9 skipped, **1 legitimate failure** — see "Route budget"
  finding below. Not a flake; re-run confirms.

## New finding — route/page slot budget (`routeConsolidationGuard.test.ts`)

This repo has a hard architectural guard (`SPEC-ROUTE-CONSOLIDATION-1`,
`scripts/count-routes.mjs`) against Vercel's **undocumented hard cap of
2048 routes** per deployment — exceeding it produces a silent
`readyState=ERROR` at deploy time with no clear log line. The guard test
computes `apiRoutes*2 + pages*2` and warns above 1900 (error at 2020 in
the authoritative `--budget` script).

Phase 1 + Phase 2 of this arc added 15 new `route.ts` files (Plaid: 3,
eligibility: 1, form1919: 2, form413: 2, kyc: 3, esign: 3, signing-status:
1) — 30 slots. That pushed the total from 1878 to **1908**, past the 1900
warning (still well under the 2048 hard cap — 140 slots of headroom
remain, ~70 more individual route files before the hard cap).

**Disposition: not fixed in this phase.** A full retrofit-consolidation of
these 15 already-tested, working routes into the codebase's established
catch-all/action-dispatch pattern (`model-v2/[action]`, `research/[action]`,
`workers/[...path]`) is a real but separate refactor with real regression
risk, and doing it reactively mid-arc is worse than doing it deliberately.
**This is flagged as an escalating risk, not a one-off**: Phases 3–6 of
this arc (S4 credit pull/912/4506-C, S6 the 504 track, S7 closing forms +
package assembly, S5 E-Tran) will each plausibly add a comparable number
of routes. At the current rate, the 2048 hard cap could be reached within
2–3 more phases. **Recommendation for whoever picks this up next:**
consolidate the SBA/Plaid/KYC/esign routes into 1–2 catch-all dispatchers
before or during Phase 3, and design all new routes in Phases 3–6 using
the catch-all pattern from the start rather than one file per endpoint.

## Known gaps — both environmental, not code

1. **No Persona account provisioned.** Blocks V-3d and any real IAL2
   verification. `src/lib/identity/kyc/persona.ts` throws a clear
   configuration error (`Missing PERSONA_API_KEY`) rather than silently
   no-op; the KYC-initiate route returns `503 persona_not_configured` if
   `PERSONA_TEMPLATE_ID_IAL2` is unset.
2. **No GCP/Cloud Run access.** Blocks actual DocuSeal deployment (V-3a/b/e).
   `infrastructure/docuseal/` is complete and ready for an operator with
   Cloud Run admin access. The DocuSeal webhook signature format
   (`X-Docuseal-Signature` header, HMAC-SHA256 of raw body) is a documented
   *assumption* — flagged explicitly in the README for verification against
   a live instance's actual webhook settings before relying on it in
   production.

Both gaps require a human to provision vendor accounts / cloud
infrastructure — outside what any executor (human or AI) can do without
those credentials, per the spec's own explicit judgment boundaries.
